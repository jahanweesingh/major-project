import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { MockWebSocket } from './test/MockWebSocket';

const historyPayload = {
  room_id: 'ROOM-42',
  messages: [{
    id: '1',
    client_message_id: 'old-1',
    sender_id: 'guest-2',
    sender_name: 'Mira',
    text: 'I am already here.',
    sent_at: '2026-09-08T09:30:00.000Z',
    kind: 'message',
  }],
  participants: [{ client_id: 'guest-2', display_name: 'Mira' }],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function enterKnownRoom() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Join room' }));
  await user.type(screen.getByLabelText('Your name'), 'Asha');
  await user.type(screen.getByLabelText('Room code'), 'room-42');
  await user.click(screen.getByRole('button', { name: 'Join conversation' }));
  await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
  return { user, socket: MockWebSocket.instances[0] };
}

describe('Phase-1 chat experience', () => {
  beforeEach(() => {
    window.localStorage.clear();
    MockWebSocket.reset();
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(historyPayload)));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('states the real security boundary before entry', () => {
    render(<App />);
    expect(screen.getByText(/Phase 1/i)).toBeVisible();
    expect(screen.getByText('Classical prototype only')).toBeVisible();
    expect(screen.getByText(/BB84 key exchange and end-to-end encryption are not active yet/i))
      .toBeVisible();
  });

  it('shows friendly, accessible onboarding validation', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Create and enter' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least 2 characters');
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('loads history, connects, sends the exact envelope, and receives messages', async () => {
    const { user, socket } = await enterKnownRoom();
    expect(fetch).toHaveBeenCalledWith(
      '/api/rooms/ROOM-42/messages?limit=50',
      expect.any(Object),
    );
    expect(screen.getByText('I am already here.')).toBeVisible();

    act(() => {
      socket.open();
      socket.receive({
        type: 'connected',
        client_id: new URL(socket.url).searchParams.get('client_id'),
        room_id: 'ROOM-42',
        participants: [{ client_id: 'guest-2', display_name: 'Mira' }],
        messages: historyPayload.messages,
      });
    });

    const composer = screen.getByRole('textbox', { name: 'Message' });
    await user.type(composer, 'Hello Mira{enter}');
    const packets = socket.sent.map((packet) => JSON.parse(packet) as Record<string, unknown>);
    const sentMessage = packets.find((packet) => packet.type === 'message');
    expect(sentMessage).toMatchObject({ type: 'message', text: 'Hello Mira' });
    expect(sentMessage?.client_message_id).toEqual(expect.any(String));
    expect(screen.getByText('Hello Mira')).toBeVisible();

    act(() => {
      socket.receive({
        type: 'error',
        code: 'message_too_long',
        message: 'Message exceeds the configured server limit',
        client_message_id: sentMessage?.client_message_id,
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('configured server limit');
    expect(screen.getByRole('button', { name: /Not sent.*Retry/i })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Not sent.*Retry/i }));
    expect(screen.queryByText('Message exceeds the configured server limit')).not.toBeInTheDocument();

    act(() => {
      socket.receive({
        type: 'message',
        message: {
          id: '2',
          client_message_id: sentMessage?.client_message_id,
          sender_id: 'guest-2',
          sender_name: 'Mira',
          text: 'Nice to meet you.',
          sent_at: '2026-09-08T09:31:00.000Z',
          kind: 'message',
        },
      });
    });
    expect(screen.getByText('Nice to meet you.')).toBeVisible();
    expect(screen.getByText('Hello Mira')).toBeVisible();
  });

  it('copies the room code and keeps the classical phase visible in chat', async () => {
    const { user, socket } = await enterKnownRoom();
    act(() => socket.open());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    expect(screen.getByText(/Phase 1/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Copy room code' }));
    expect(writeText).toHaveBeenCalledWith('ROOM-42');
    expect(screen.getByText('Copied')).toBeVisible();
  });

  it('treats a full room as terminal instead of reconnecting', async () => {
    const { socket } = await enterKnownRoom();
    act(() => {
      socket.open();
      socket.receive({
        type: 'error',
        code: 'room_full',
        message: 'This room already has two distinct clients',
      });
      socket.serverClose(4403, 'This room already has two distinct clients');
    });
    expect(await screen.findByText('This room already has two distinct clients')).toBeVisible();
    await new Promise((resolve) => window.setTimeout(resolve, 1_100));
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
