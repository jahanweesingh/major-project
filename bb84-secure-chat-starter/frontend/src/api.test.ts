import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildWebSocketUrl,
  createRoomCode,
  getHealth,
  getRoomSnapshot,
  normalizeMessage,
  normalizeParticipant,
  normalizeRoomCode,
} from './api';

describe('chat API contract', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes room codes and creates backend-safe codes', () => {
    expect(normalizeRoomCode('  room !! 42  ')).toBe('ROOM42');
    expect(normalizeRoomCode('---room-42')).toBe('ROOM-42');
    expect(createRoomCode()).toMatch(/^QKD-[A-Z2-9]{6}$/);
  });

  it('normalizes exact nested server messages and participant shapes', () => {
    expect(normalizeMessage({
      type: 'message',
      message: {
        id: '17',
        client_message_id: 'client-message-1',
        sender_id: 'guest-2',
        sender_name: 'Mira',
        text: 'Hello from the other side',
        sent_at: '2026-09-08T09:30:00.000Z',
        kind: 'message',
      },
    })).toMatchObject({
      id: '17',
      clientMessageId: 'client-message-1',
      senderId: 'guest-2',
      senderName: 'Mira',
      text: 'Hello from the other side',
      status: 'sent',
    });
    expect(normalizeParticipant({ client_id: 'guest-2', display_name: 'Mira' }))
      .toEqual({ id: 'guest-2', name: 'Mira', online: true });
  });

  it('uses the documented health and room-history endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'ok',
        database: 'ok',
        service: 'secure-chat-starter',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        room_id: 'ROOM-42',
        messages: [],
        participants: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getHealth()).resolves.toBe(true);
    await expect(getRoomSnapshot('ROOM-42')).resolves.toEqual({ messages: [], participants: [] });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/health', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/rooms/ROOM-42/messages?limit=50',
      expect.any(Object),
    );
  });

  it('builds a same-origin WebSocket URL with exact backend parameters', () => {
    const url = new URL(buildWebSocketUrl({
      roomCode: 'ROOM-42',
      clientId: 'client-7',
      displayName: 'Asha Rao',
    }));
    expect(url.pathname).toBe('/ws/ROOM-42');
    expect(url.searchParams.get('client_id')).toBe('client-7');
    expect(url.searchParams.get('display_name')).toBe('Asha Rao');
    expect(['ws:', 'wss:']).toContain(url.protocol);
  });
});
