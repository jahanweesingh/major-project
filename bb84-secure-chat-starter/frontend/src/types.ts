export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'error';

export const MAX_MESSAGE_LENGTH = 2_000;

export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  id: string;
  clientMessageId?: string;
  senderId: string;
  senderName: string;
  text: string;
  sentAt: string;
  kind: 'message' | 'system';
  status?: MessageStatus;
}

export interface Participant {
  id: string;
  name: string;
  online: boolean;
  joinedAt?: string;
}

export interface ChatSession {
  clientId: string;
  displayName: string;
  roomCode: string;
}

export interface RoomSnapshot {
  messages: ChatMessage[];
  participants: Participant[];
}

export interface JoinRoomInput {
  displayName: string;
  roomCode?: string;
  mode?: 'create' | 'join';
}

export interface JoinRoomResult extends ChatSession, RoomSnapshot {}

export interface ConnectionInfo {
  state: ConnectionState;
  attempt: number;
  nextRetrySeconds: number | null;
  error: string | null;
}
