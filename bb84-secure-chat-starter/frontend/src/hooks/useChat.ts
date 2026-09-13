import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildWebSocketUrl,
  normalizeMessage,
  normalizeParticipant,
  parseSocketPayload,
  readArray,
  readBoolean,
  readEventType,
  readString,
} from '../api';
import type {
  ChatMessage,
  ChatSession,
  ConnectionInfo,
  Participant,
  RoomSnapshot,
} from '../types';
import { MAX_MESSAGE_LENGTH } from '../types';

const MAX_RECONNECT_DELAY_MS = 8_000;
const TYPING_TTL_MS = 2_200;
const PING_INTERVAL_MS = 20_000;

function newMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `message-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((left, right) => {
    const delta = Date.parse(left.sentAt) - Date.parse(right.sentAt);
    return Number.isNaN(delta) ? 0 : delta;
  });
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const next = [...current];
  for (const message of incoming) {
    const optimisticIndex = message.clientMessageId
      ? next.findIndex(
          (item) => item.senderId === message.senderId
            && item.clientMessageId === message.clientMessageId,
        )
      : -1;
    const idIndex = next.findIndex((item) => item.id === message.id);
    const index = optimisticIndex >= 0 ? optimisticIndex : idIndex;
    if (index >= 0) {
      next[index] = { ...next[index], ...message, status: 'sent' };
    } else {
      next.push({ ...message, status: 'sent' });
    }
  }
  return sortMessages(next);
}

function mergeParticipant(current: Participant[], incoming: Participant): Participant[] {
  const existingIndex = current.findIndex((participant) => participant.id === incoming.id);
  if (existingIndex < 0) return [...current, incoming];
  return current.map((participant, index) =>
    index === existingIndex ? { ...participant, ...incoming } : participant,
  );
}

export interface ChatController {
  messages: ChatMessage[];
  participants: Participant[];
  typingNames: string[];
  connection: ConnectionInfo;
  sendMessage: (text: string) => boolean;
  retryMessage: (id: string) => boolean;
  setTyping: (isTyping: boolean) => void;
  reconnect: () => void;
}

export function useChat(
  session: ChatSession | null,
  initialSnapshot: RoomSnapshot,
): ChatController {
  const [messages, setMessages] = useState<ChatMessage[]>(initialSnapshot.messages);
  const [participants, setParticipants] = useState<Participant[]>(initialSnapshot.participants);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [connection, setConnection] = useState<ConnectionInfo>({
    state: 'idle',
    attempt: 0,
    nextRetrySeconds: null,
    error: null,
  });
  const [reconnectToken, setReconnectToken] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const typingTimeoutsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    setMessages(initialSnapshot.messages);
    const withSelf = session
      ? mergeParticipant(initialSnapshot.participants, {
          id: session.clientId,
          name: session.displayName,
          online: true,
        })
      : initialSnapshot.participants;
    setParticipants(withSelf);
    setTypingUsers({});
  }, [initialSnapshot, session]);

  useEffect(() => {
    if (!session) {
      setConnection({ state: 'idle', attempt: 0, nextRetrySeconds: null, error: null });
      return undefined;
    }

    let disposed = false;
    let retryAttempt = 0;
    let retryTimer: number | undefined;
    let countdownTimer: number | undefined;
    let pingTimer: number | undefined;
    let terminalError: string | null = null;

    const clearTimers = () => {
      window.clearTimeout(retryTimer);
      window.clearInterval(countdownTimer);
      window.clearInterval(pingTimer);
    };

    const updateParticipants = (rawParticipants: unknown[]) => {
      const normalized = rawParticipants
        .map((participant, index) => normalizeParticipant(participant, index))
        .filter((participant): participant is Participant => participant !== null);
      setParticipants(
        mergeParticipant(normalized, {
          id: session.clientId,
          name: session.displayName,
          online: true,
        }),
      );
    };

    const handleMessage = (rawPayload: string) => {
      const event = parseSocketPayload(rawPayload);
      if (!event) return;
      const type = readEventType(event);

      if (type === 'connected') {
        updateParticipants(readArray(event, ['participants', 'members']));
        const history = readArray(event, ['messages', 'history'])
          .map((item, index) => normalizeMessage(item, index))
          .filter((item): item is ChatMessage => item !== null);
        if (history.length > 0) setMessages((current) => mergeMessages(current, history));
        return;
      }

      if (type === 'message' || type === 'chat_message') {
        const message = normalizeMessage(event);
        if (message) setMessages((current) => mergeMessages(current, [message]));
        return;
      }

      if (type === 'message_ack' || type === 'ack') {
        const clientMessageId = readString(event, ['client_message_id', 'clientMessageId']);
        const serverId = readString(event, ['message_id', 'messageId', 'id']);
        const sentAt = readString(event, ['sent_at', 'sentAt']);
        if (clientMessageId) {
          setMessages((current) =>
            current.map((message) =>
              message.senderId === session.clientId && message.clientMessageId === clientMessageId
                ? {
                    ...message,
                    id: serverId || message.id,
                    sentAt: sentAt || message.sentAt,
                    status: 'sent',
                  }
                : message,
            ),
          );
          setConnection((current) => ({ ...current, error: null }));
        }
        return;
      }

      if (type === 'presence') {
        if (Array.isArray(event.participants) || Array.isArray(event.members)) {
          updateParticipants(readArray(event, ['participants', 'members']));
          return;
        }
        const rawParticipant = event.participant ?? event.user ?? event;
        const participant = normalizeParticipant(rawParticipant);
        if (!participant || participant.id === session.clientId) return;
        const action = readString(event, ['action', 'status']).toLowerCase();
        const online = action
          ? !['leave', 'left', 'offline', 'disconnected'].includes(action)
          : participant.online;
        setParticipants((current) => mergeParticipant(current, { ...participant, online }));
        return;
      }

      if (type === 'typing') {
        const participantId = readString(event, [
          'client_id',
          'clientId',
          'sender_id',
          'user_id',
        ]);
        const participantName = readString(event, [
          'display_name',
          'displayName',
          'sender_name',
          'name',
        ]);
        if (!participantId || participantId === session.clientId || !participantName) return;
        window.clearTimeout(typingTimeoutsRef.current[participantId]);
        if (readBoolean(event, ['is_typing', 'isTyping'], false)) {
          setTypingUsers((current) => ({ ...current, [participantId]: participantName }));
          typingTimeoutsRef.current[participantId] = window.setTimeout(() => {
            setTypingUsers((current) => {
              const next = { ...current };
              delete next[participantId];
              return next;
            });
          }, TYPING_TTL_MS);
        } else {
          setTypingUsers((current) => {
            const next = { ...current };
            delete next[participantId];
            return next;
          });
        }
        return;
      }

      if (type === 'error') {
        const message = readString(event, ['message', 'detail'], 'The server rejected that action.');
        const code = readString(event, ['code']).toLowerCase();
        const clientMessageId = readString(event, ['client_message_id', 'clientMessageId']);
        if (clientMessageId) {
          setMessages((current) => current.map((item) =>
            item.senderId === session.clientId && item.clientMessageId === clientMessageId
              ? { ...item, status: 'failed' }
              : item,
          ));
        }
        if (['room_full', 'client_already_connected', 'invalid_identity', 'origin_not_allowed'].includes(code)) {
          terminalError = message;
          setConnection((current) => ({ ...current, state: 'error', error: message }));
        } else {
          setConnection((current) => ({ ...current, error: message }));
        }
      }
    };

    const scheduleReconnect = (openSocket: () => void) => {
      if (disposed) return;
      if (!navigator.onLine) {
        setConnection({
          state: 'offline',
          attempt: retryAttempt,
          nextRetrySeconds: null,
          error: 'This device is offline.',
        });
        return;
      }
      retryAttempt += 1;
      const delay = Math.min(1_000 * 2 ** (retryAttempt - 1), MAX_RECONNECT_DELAY_MS);
      const deadline = Date.now() + delay;
      setConnection({
        state: 'reconnecting',
        attempt: retryAttempt,
        nextRetrySeconds: Math.ceil(delay / 1_000),
        error: 'Connection interrupted. Messages are paused while we reconnect.',
      });
      window.clearInterval(countdownTimer);
      countdownTimer = window.setInterval(() => {
        setConnection((current) => ({
          ...current,
          nextRetrySeconds: Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)),
        }));
      }, 250);
      retryTimer = window.setTimeout(() => {
        window.clearInterval(countdownTimer);
        openSocket();
      }, delay);
    };

    const openSocket = () => {
      if (disposed || !navigator.onLine) {
        setConnection({
          state: 'offline',
          attempt: retryAttempt,
          nextRetrySeconds: null,
          error: 'This device is offline.',
        });
        return;
      }
      setConnection({
        state: retryAttempt > 0 ? 'reconnecting' : 'connecting',
        attempt: retryAttempt,
        nextRetrySeconds: null,
        error: null,
      });
      const socket = new WebSocket(buildWebSocketUrl(session));
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        if (disposed) return;
        retryAttempt = 0;
        setConnection({ state: 'connected', attempt: 0, nextRetrySeconds: null, error: null });
        pingTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, PING_INTERVAL_MS);
      });
      socket.addEventListener('message', (event: MessageEvent<string>) => handleMessage(event.data));
      socket.addEventListener('error', () => {
        if (!disposed) {
          setConnection((current) => ({
            ...current,
            error: 'The real-time connection could not be established.',
          }));
        }
      });
      socket.addEventListener('close', (event) => {
        window.clearInterval(pingTimer);
        if (disposed) return;
        socketRef.current = null;
        if (terminalError || [4003, 4400, 4403, 4409].includes(event.code)) {
          setConnection({
            state: 'error',
            attempt: retryAttempt,
            nextRetrySeconds: null,
            error: terminalError || event.reason || 'This room already has two participants.',
          });
          return;
        }
        scheduleReconnect(openSocket);
      });
    };

    const handleOffline = () => {
      setConnection({
        state: 'offline',
        attempt: retryAttempt,
        nextRetrySeconds: null,
        error: 'This device is offline.',
      });
      socketRef.current?.close();
    };
    const handleOnline = () => {
      clearTimers();
      retryAttempt = 0;
      openSocket();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    openSocket();

    return () => {
      disposed = true;
      clearTimers();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      Object.values(typingTimeoutsRef.current).forEach((timeout) => window.clearTimeout(timeout));
      typingTimeoutsRef.current = {};
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Client left room');
    };
  }, [reconnectToken, session]);

  const transmitMessage = useCallback(
    (message: ChatMessage): boolean => {
      const socket = socketRef.current;
      if (!session || !socket || socket.readyState !== WebSocket.OPEN) return false;
      try {
        socket.send(
          JSON.stringify({
            type: 'message',
            text: message.text,
            client_message_id: message.clientMessageId,
          }),
        );
        return true;
      } catch {
        return false;
      }
    },
    [session],
  );

  const sendMessage = useCallback(
    (text: string): boolean => {
      const cleanText = text.trim();
      if (!session || !cleanText || cleanText.length > MAX_MESSAGE_LENGTH) return false;
      setConnection((current) => ({ ...current, error: null }));
      const clientMessageId = newMessageId();
      const message: ChatMessage = {
        id: `pending-${clientMessageId}`,
        clientMessageId,
        senderId: session.clientId,
        senderName: session.displayName,
        text: cleanText,
        sentAt: new Date().toISOString(),
        kind: 'message',
        status: 'sending',
      };
      setMessages((current) =>
        mergeMessages(current, [message]).map((item) =>
          item.clientMessageId === clientMessageId ? { ...item, status: 'sending' } : item,
        ),
      );
      const sent = transmitMessage(message);
      if (!sent) {
        setMessages((current) =>
          current.map((item) =>
            item.clientMessageId === clientMessageId ? { ...item, status: 'failed' } : item,
          ),
        );
      }
      return sent;
    },
    [session, transmitMessage],
  );

  const retryMessage = useCallback(
    (id: string): boolean => {
      const message = messages.find((item) => item.id === id);
      if (!message) return false;
      setConnection((current) => ({ ...current, error: null }));
      const sent = transmitMessage(message);
      setMessages((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: sent ? 'sending' : 'failed' } : item,
        ),
      );
      return sent;
    },
    [messages, transmitMessage],
  );

  const setTyping = useCallback((isTyping: boolean) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'typing', is_typing: isTyping }));
  }, []);

  const reconnect = useCallback(() => {
    socketRef.current?.close(1000, 'Manual reconnect');
    setReconnectToken((value) => value + 1);
  }, []);

  const typingNames = useMemo(() => Object.values(typingUsers), [typingUsers]);

  return {
    messages,
    participants,
    typingNames,
    connection,
    sendMessage,
    retryMessage,
    setTyping,
    reconnect,
  };
}
