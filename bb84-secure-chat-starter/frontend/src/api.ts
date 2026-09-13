import type {
  ChatMessage,
  JoinRoomInput,
  JoinRoomResult,
  Participant,
  RoomSnapshot,
} from './types';

const API_ROOT = '/api';
const REQUEST_TIMEOUT_MS = 10_000;

type JsonObject = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function firstString(source: JsonObject, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = asString(source[key]);
    if (value) return value;
  }
  return fallback;
}

export function createClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeRoomCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 18);
}

export function createRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `QKD-${code}`;
}

export function normalizeMessage(value: unknown, fallbackIndex = 0): ChatMessage | null {
  if (!isObject(value)) return null;
  const nested = isObject(value.message) ? value.message : value;
  const text = firstString(nested, ['text', 'content', 'body']);
  const kindValue = firstString(nested, ['kind', 'message_type', 'type']);
  const kind = kindValue === 'system' ? 'system' : 'message';
  if (!text && kind !== 'system') return null;

  const sender = isObject(nested.sender) ? nested.sender : {};
  const senderId = firstString(
    nested,
    ['sender_id', 'senderId', 'client_id', 'clientId', 'user_id'],
    firstString(sender, ['id', 'client_id'], 'unknown'),
  );
  const senderName = firstString(
    nested,
    ['sender_name', 'senderName', 'display_name', 'displayName', 'name'],
    firstString(sender, ['name', 'display_name'], kind === 'system' ? 'System' : 'Guest'),
  );
  const id = firstString(
    nested,
    ['id', 'message_id', 'messageId'],
    `history-${fallbackIndex}-${senderId}-${text.slice(0, 12)}`,
  );

  return {
    id,
    clientMessageId: firstString(nested, ['client_message_id', 'clientMessageId']) || undefined,
    senderId,
    senderName,
    text,
    sentAt: firstString(nested, ['sent_at', 'sentAt', 'timestamp', 'created_at'], new Date().toISOString()),
    kind,
    status: 'sent',
  };
}

export function normalizeParticipant(value: unknown, fallbackIndex = 0): Participant | null {
  if (!isObject(value)) return null;
  const name = firstString(value, ['name', 'display_name', 'displayName']);
  if (!name) return null;
  return {
    id: firstString(value, ['id', 'client_id', 'clientId', 'user_id'], `guest-${fallbackIndex}`),
    name,
    online: typeof value.online === 'boolean' ? value.online : true,
    joinedAt: firstString(value, ['joined_at', 'joinedAt']) || undefined,
  };
}

function normalizeSnapshot(payload: unknown): RoomSnapshot {
  if (!isObject(payload)) return { messages: [], participants: [] };
  const rawMessages = Array.isArray(payload.messages)
    ? payload.messages
    : Array.isArray(payload.history)
      ? payload.history
      : [];
  const rawParticipants = Array.isArray(payload.participants)
    ? payload.participants
    : Array.isArray(payload.members)
      ? payload.members
      : [];
  return {
    messages: rawMessages
      .map((message, index) => normalizeMessage(message, index))
      .filter((message): message is ChatMessage => message !== null),
    participants: rawParticipants
      .map((participant, index) => normalizeParticipant(participant, index))
      .filter((participant): participant is Participant => participant !== null),
  };
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    let body: unknown = null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      body = await response.json();
    }
    if (!response.ok) {
      const detail = isObject(body)
        ? firstString(body, ['detail', 'message', 'error'])
        : '';
      throw new ApiError(detail || `Request failed with status ${response.status}`, response.status);
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The server took too long to respond. Please try again.');
    }
    throw new ApiError('Could not reach the chat server. Check that it is running and try again.');
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function joinRoom(input: JoinRoomInput): Promise<JoinRoomResult> {
  const requestedRoom = normalizeRoomCode(input.roomCode || createRoomCode());
  let snapshot: RoomSnapshot = { messages: [], participants: [] };
  try {
    snapshot = await getRoomSnapshot(requestedRoom);
  } catch (error) {
    // A new room does not have durable history yet. Its WebSocket connection
    // creates the live room, so a history 404 is expected during create flow.
    if (!(input.mode === 'create' && error instanceof ApiError && error.status === 404)) {
      throw error;
    }
  }

  return {
    clientId: createClientId(),
    displayName: input.displayName.trim(),
    roomCode: requestedRoom,
    ...snapshot,
  };
}

export async function getRoomSnapshot(roomCode: string): Promise<RoomSnapshot> {
  const payload = await requestJson(`/rooms/${encodeURIComponent(roomCode)}/messages?limit=50`);
  return normalizeSnapshot(payload);
}

export async function getHealth(): Promise<boolean> {
  await requestJson('/health');
  return true;
}

export function buildWebSocketUrl(session: {
  roomCode: string;
  clientId: string;
  displayName: string;
}): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const roomPath = encodeURIComponent(session.roomCode);
  const url = new URL(`/ws/${roomPath}`, `${protocol}//${window.location.host}`);
  url.searchParams.set('client_id', session.clientId);
  url.searchParams.set('display_name', session.displayName);
  return url.toString();
}

export function parseSocketPayload(payload: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readEventType(event: JsonObject): string {
  return firstString(event, ['type', 'event', 'event_type']).toLowerCase();
}

export function readString(event: JsonObject, keys: string[], fallback = ''): string {
  return firstString(event, keys, fallback);
}

export function readBoolean(event: JsonObject, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    if (typeof event[key] === 'boolean') return event[key];
  }
  return fallback;
}

export function readArray(event: JsonObject, keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(event[key])) return event[key];
  }
  return [];
}
