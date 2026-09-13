import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Atom,
  Check,
  CheckCheck,
  CircleAlert,
  Clipboard,
  Clock3,
  Copy,
  FlaskConical,
  LoaderCircle,
  Menu,
  MessageCircle,
  Radio,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  UserRound,
  UsersRound,
  WifiOff,
  X,
} from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createRoomCode, joinRoom, normalizeRoomCode } from './api';
import { useChat } from './hooks/useChat';
import type {
  ChatMessage,
  ChatSession,
  ConnectionInfo,
  JoinRoomResult,
  Participant,
  RoomSnapshot,
} from './types';
import { MAX_MESSAGE_LENGTH } from './types';

const EMPTY_SNAPSHOT: RoomSnapshot = { messages: [], participants: [] };
const NAME_STORAGE_KEY = 'bb84-chat-display-name';
const ROOM_STORAGE_KEY = 'bb84-chat-room-code';

function loadPreference(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function savePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is a convenience only. The chat works when it is unavailable.
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function sameCalendarDay(left: string, right: string): boolean {
  const first = new Date(left);
  const second = new Date(right);
  return !Number.isNaN(first.getTime())
    && !Number.isNaN(second.getTime())
    && first.toDateString() === second.toDateString();
}

interface PhaseBadgeProps {
  compact?: boolean;
}

function PhaseBadge({ compact = false }: PhaseBadgeProps) {
  return (
    <span className={`phase-badge${compact ? ' phase-badge--compact' : ''}`}>
      <span className="phase-badge__dot" aria-hidden="true" />
      Phase 1 <span aria-hidden="true">•</span> classical transport
    </span>
  );
}

interface OnboardingProps {
  onJoin: (input: {
    displayName: string;
    roomCode: string;
    mode: 'create' | 'join';
  }) => Promise<void>;
}

function Onboarding({ onJoin }: OnboardingProps) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [displayName, setDisplayName] = useState(() => loadPreference(NAME_STORAGE_KEY));
  const [roomCode, setRoomCode] = useState(() => createRoomCode());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const changeMode = (nextMode: 'create' | 'join') => {
    setMode(nextMode);
    setError('');
    setRoomCode(nextMode === 'create' ? createRoomCode() : loadPreference(ROOM_STORAGE_KEY));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = displayName.trim();
    const cleanRoom = normalizeRoomCode(roomCode);
    if (cleanName.length < 2) {
      setError('Enter a name with at least 2 characters.');
      return;
    }
    if (cleanName.length > 24) {
      setError('Keep your name to 24 characters or fewer.');
      return;
    }
    if (!/^[A-Z0-9][A-Z0-9-]{3,17}$/.test(cleanRoom)) {
      setError('Use 4–18 letters, numbers, or hyphens, starting with a letter or number.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onJoin({ displayName: cleanName, roomCode: cleanRoom, mode });
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Could not open the room.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="onboarding-shell">
      <div className="ambient ambient--one" aria-hidden="true" />
      <div className="ambient ambient--two" aria-hidden="true" />
      <section className="onboarding-story" aria-labelledby="welcome-title">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><Atom size={25} strokeWidth={1.8} /></span>
          <span>QKD Chat Lab</span>
        </div>
        <div className="onboarding-story__content">
          <PhaseBadge />
          <h1 id="welcome-title">A calm space for a two-person conversation.</h1>
          <p>
            Test the classical chat foundation for the BB84 project. Create a room,
            share its code, and watch messages arrive in real time.
          </p>
          <ul className="feature-list" aria-label="Prototype capabilities">
            <li><Radio size={18} /> Live WebSocket delivery</li>
            <li><MessageCircle size={18} /> Durable local message history</li>
            <li><UsersRound size={18} /> Two participants per room</li>
          </ul>
        </div>
        <div className="story-orbit" aria-hidden="true">
          <span className="story-orbit__core"><Atom size={36} /></span>
          <span className="story-orbit__path story-orbit__path--one" />
          <span className="story-orbit__path story-orbit__path--two" />
          <span className="story-orbit__particle story-orbit__particle--one" />
          <span className="story-orbit__particle story-orbit__particle--two" />
        </div>
        <p className="story-footnote">Local prototype · temporary identity · plaintext on the server</p>
      </section>

      <section className="onboarding-panel" aria-labelledby="join-title">
        <div className="onboarding-card">
          <div className="onboarding-card__header">
            <span className="eyebrow">Start a conversation</span>
            <h2 id="join-title">Enter the chat lab</h2>
            <p>Use a name your room partner will recognize.</p>
          </div>

          <div className="mode-switch" role="group" aria-label="Room action">
            <button
              type="button"
              className={mode === 'create' ? 'is-active' : ''}
              aria-pressed={mode === 'create'}
              onClick={() => changeMode('create')}
            >
              Create room
            </button>
            <button
              type="button"
              className={mode === 'join' ? 'is-active' : ''}
              aria-pressed={mode === 'join'}
              onClick={() => changeMode('join')}
            >
              Join room
            </button>
          </div>

          <form className="onboarding-form" onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="display-name">Your name</label>
              <span className="field__control">
                <UserRound size={18} aria-hidden="true" />
                <input
                  id="display-name"
                  autoFocus
                  name="displayName"
                  autoComplete="name"
                  maxLength={24}
                  placeholder="e.g. Nityam"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  disabled={submitting}
                />
              </span>
            </div>

            <div className="field">
              <label htmlFor="room-code">{mode === 'create' ? 'Your new room code' : 'Room code'}</label>
              <span className="field__control field__control--code">
                <span className="code-prefix" aria-hidden="true">#</span>
                <input
                  id="room-code"
                  name="roomCode"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="text"
                  maxLength={18}
                  placeholder="QKD-ABC123"
                  value={roomCode}
                  readOnly={mode === 'create'}
                  onChange={(event) => setRoomCode(normalizeRoomCode(event.target.value))}
                  disabled={submitting}
                />
                {mode === 'create' && (
                  <button
                    type="button"
                    className="field__action"
                    aria-label="Generate another room code"
                    title="Generate another code"
                    onClick={() => setRoomCode(createRoomCode())}
                    disabled={submitting}
                  >
                    <RefreshCw size={17} />
                  </button>
                )}
              </span>
            </div>

            {error && (
              <div className="inline-error" role="alert">
                <CircleAlert size={17} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? (
                <><LoaderCircle className="spin" size={19} /> Opening room…</>
              ) : (
                <>{mode === 'create' ? 'Create and enter' : 'Join conversation'} <ArrowRight size={19} /></>
              )}
            </button>
          </form>

          <aside className="honesty-note" aria-label="Current security status">
            <FlaskConical size={19} aria-hidden="true" />
            <div>
              <strong>Classical prototype only</strong>
              <p>BB84 key exchange and end-to-end encryption are not active yet. Do not share confidential information.</p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

interface ConnectionBadgeProps {
  connection: ConnectionInfo;
}

function ConnectionBadge({ connection }: ConnectionBadgeProps) {
  const content = {
    idle: { label: 'Not connected', icon: WifiOff },
    connecting: { label: 'Connecting', icon: LoaderCircle },
    connected: { label: 'Live', icon: Radio },
    reconnecting: { label: 'Reconnecting', icon: RefreshCw },
    offline: { label: 'Offline', icon: WifiOff },
    error: { label: 'Needs attention', icon: AlertCircle },
  }[connection.state];
  const Icon = content.icon;
  return (
    <span className={`connection-badge connection-badge--${connection.state}`}>
      <Icon
        size={14}
        aria-hidden="true"
        className={['connecting', 'reconnecting'].includes(connection.state) ? 'spin' : ''}
      />
      <span>{content.label}</span>
    </span>
  );
}

interface ParticipantListProps {
  participants: Participant[];
  currentClientId: string;
}

function ParticipantList({ participants, currentClientId }: ParticipantListProps) {
  const visibleParticipants = participants.slice(0, 2);
  return (
    <div className="participants-section">
      <div className="section-heading">
        <span>In this room</span>
        <span>{visibleParticipants.filter((participant) => participant.online).length}/2</span>
      </div>
      <ul className="participant-list">
        {visibleParticipants.map((participant) => (
          <li key={participant.id}>
            <span className="avatar avatar--small" aria-hidden="true">
              {initials(participant.name)}
              <span className={`presence-dot${participant.online ? ' is-online' : ''}`} />
            </span>
            <span className="participant-copy">
              <strong>{participant.name}{participant.id === currentClientId ? ' (you)' : ''}</strong>
              <span>{participant.online ? 'Online now' : 'Disconnected'}</span>
            </span>
          </li>
        ))}
        {visibleParticipants.length < 2 && (
          <li className="waiting-participant">
            <span className="avatar avatar--small avatar--empty" aria-hidden="true"><UsersRound size={16} /></span>
            <span className="participant-copy">
              <strong>Waiting for someone</strong>
              <span>Share the room code</span>
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

interface ChatSidebarProps {
  open: boolean;
  session: ChatSession;
  participants: Participant[];
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  onLeave: () => void;
}

function ChatSidebar({
  open,
  session,
  participants,
  copied,
  onCopy,
  onClose,
  onLeave,
}: ChatSidebarProps) {
  return (
    <>
      <button
        className={`sidebar-backdrop${open ? ' is-visible' : ''}`}
        type="button"
        aria-label="Close room details"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside className={`chat-sidebar${open ? ' is-open' : ''}`} aria-label="Room details">
        <div className="sidebar-brand">
          <span className="brand-mark brand-mark--small" aria-hidden="true"><Atom size={21} /></span>
          <div><strong>QKD Chat Lab</strong><span>BB84 project</span></div>
          <button className="icon-button sidebar-close" type="button" aria-label="Close room details" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="room-card">
          <span className="room-card__eyebrow">Current room</span>
          <div className="room-card__code">
            <strong>{session.roomCode}</strong>
            <button className="copy-button" type="button" onClick={onCopy} aria-label="Copy room code">
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p>Share this code with one person you trust to join the same room.</p>
        </div>

        <ParticipantList participants={participants} currentClientId={session.clientId} />

        <div className="sidebar-spacer" />

        <aside className="phase-card">
          <div className="phase-card__top"><FlaskConical size={17} /><span>Current phase</span></div>
          <strong>Classical chat foundation</strong>
          <p>Messages are plaintext on this local server. BB84 key exchange and end-to-end encryption are not active.</p>
          <span>For local testing only</span>
        </aside>

        <button className="leave-button" type="button" onClick={onLeave}>
          <ArrowLeft size={17} /> Leave room
        </button>
      </aside>
    </>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  onRetry: (id: string) => void;
}

function MessageBubble({ message, mine, grouped, onRetry }: MessageBubbleProps) {
  if (message.kind === 'system') {
    return <div className="system-message"><span>{message.text}</span></div>;
  }
  return (
    <article className={`message-row${mine ? ' message-row--mine' : ''}${grouped ? ' is-grouped' : ''}`}>
      {!mine && !grouped && <span className="avatar" aria-hidden="true">{initials(message.senderName)}</span>}
      {!mine && grouped && <span className="avatar-spacer" aria-hidden="true" />}
      <div className="message-content">
        {!mine && !grouped && <span className="message-sender">{message.senderName}</span>}
        <div className="message-bubble"><p>{message.text}</p></div>
        <div className="message-meta">
          <time dateTime={message.sentAt}>{timeLabel(message.sentAt)}</time>
          {mine && message.status === 'sending' && <span><Clock3 size={12} /> Sending</span>}
          {mine && message.status === 'sent' && <span><CheckCheck size={13} /> Sent</span>}
          {mine && message.status === 'failed' && (
            <button type="button" onClick={() => onRetry(message.id)}>
              <AlertCircle size={12} /> Not sent · Retry
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

interface ConnectionNoticeProps {
  connection: ConnectionInfo;
  onReconnect: () => void;
}

function ConnectionNotice({ connection, onReconnect }: ConnectionNoticeProps) {
  if ((connection.state === 'connected' && !connection.error) || connection.state === 'idle') return null;
  const isWaiting = ['connecting', 'reconnecting'].includes(connection.state);
  const canReconnect = !isWaiting && connection.state !== 'connected';
  let message = connection.error || 'Opening the real-time connection…';
  if (connection.state === 'reconnecting' && connection.nextRetrySeconds !== null) {
    message = `Connection interrupted. Retrying in ${connection.nextRetrySeconds}s.`;
  }
  return (
    <div
      className={`connection-notice connection-notice--${connection.error ? 'error' : connection.state}`}
      role={connection.error ? 'alert' : 'status'}
      aria-live="polite"
    >
      {isWaiting ? <LoaderCircle className="spin" size={17} /> : connection.state === 'connected' ? <AlertCircle size={17} /> : <WifiOff size={17} />}
      <span>{message}</span>
      {canReconnect && (
        <button type="button" onClick={onReconnect}><RefreshCw size={14} /> Try again</button>
      )}
    </div>
  );
}

interface ChatViewProps {
  session: ChatSession;
  snapshot: RoomSnapshot;
  onLeave: () => void;
}

function ChatView({ session, snapshot, onLeave }: ChatViewProps) {
  const {
    messages,
    participants,
    typingNames,
    connection,
    sendMessage,
    retryMessage,
    setTyping,
    reconnect,
  } = useChat(session, snapshot);
  const [draft, setDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const typingStopTimer = useRef<number | undefined>();
  const previousCount = useRef(messages.length);

  const onlineCount = participants.filter((participant) => participant.online).length;

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    endRef.current?.scrollIntoView?.({ behavior, block: 'end' });
    setUnreadBelow(0);
    setAtBottom(true);
  }, []);

  useEffect(() => {
    const lastMessage = messages.at(-1);
    const isMine = lastMessage?.senderId === session.clientId;
    if (messages.length > previousCount.current) {
      if (atBottom || isMine) {
        scrollToLatest(isMine ? 'smooth' : 'auto');
      } else {
        setUnreadBelow((count) => count + (messages.length - previousCount.current));
      }
    }
    previousCount.current = messages.length;
  }, [atBottom, messages, scrollToLatest, session.clientId]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(typingStopTimer.current);
    setTyping(false);
  }, [setTyping]);

  const copyRoom = async () => {
    try {
      await navigator.clipboard.writeText(session.roomCode);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = session.roomCode;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  };

  const submitMessage = () => {
    if (!draft.trim() || connection.state !== 'connected') return;
    if (sendMessage(draft)) {
      setDraft('');
      window.clearTimeout(typingStopTimer.current);
      setTyping(false);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitMessage();
    }
  };

  const updateDraft = (value: string) => {
    setDraft(value.slice(0, MAX_MESSAGE_LENGTH));
    if (value.trim()) {
      setTyping(true);
      window.clearTimeout(typingStopTimer.current);
      typingStopTimer.current = window.setTimeout(() => setTyping(false), 1_200);
    } else {
      setTyping(false);
    }
  };

  const handleScroll = () => {
    const element = listRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    setAtBottom(nearBottom);
    if (nearBottom) setUnreadBelow(0);
  };

  return (
    <div className="chat-app">
      <a className="skip-link" href="#message-composer">Skip to message composer</a>
      <ChatSidebar
        open={sidebarOpen}
        session={session}
        participants={participants}
        copied={copied}
        onCopy={copyRoom}
        onClose={() => setSidebarOpen(false)}
        onLeave={onLeave}
      />

      <main className="conversation-shell">
        <header className="conversation-header">
          <button
            type="button"
            className="icon-button mobile-menu"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open room details"
            aria-expanded={sidebarOpen}
          >
            <Menu size={21} />
          </button>
          <div className="conversation-title">
            <span className="conversation-title__icon" aria-hidden="true"><MessageCircle size={20} /></span>
            <div>
              <h1>Room {session.roomCode}</h1>
              <span>{onlineCount < 2 ? 'Waiting for your room partner' : 'Both participants are here'}</span>
            </div>
          </div>
          <div className="conversation-header__meta">
            <PhaseBadge compact />
            <ConnectionBadge connection={connection} />
          </div>
        </header>

        <ConnectionNotice connection={connection} onReconnect={reconnect} />

        <section
          className="message-list"
          ref={listRef}
          onScroll={handleScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Conversation messages"
        >
          {messages.length === 0 && connection.state === 'connecting' ? (
            <div className="loading-state" role="status">
              <span className="loading-state__orbit"><Atom size={25} /></span>
              <strong>Opening your room</strong>
              <span>Loading recent messages and presence…</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__art" aria-hidden="true">
                <Sparkles size={25} />
                <i /><i /><i />
              </span>
              <h2>Your room is ready</h2>
              <p>Share <strong>{session.roomCode}</strong> with one person, then send the first message.</p>
              <button type="button" onClick={copyRoom}>
                {copied ? <Check size={16} /> : <Clipboard size={16} />}
                {copied ? 'Room code copied' : 'Copy room code'}
              </button>
            </div>
          ) : (
            <div className="message-stack">
              {messages.map((message, index) => {
                const previous = messages[index - 1];
                const grouped = Boolean(
                  previous
                    && previous.kind === 'message'
                    && previous.senderId === message.senderId
                    && Date.parse(message.sentAt) - Date.parse(previous.sentAt) < 5 * 60_000,
                );
                const showDate = !previous || !sameCalendarDay(previous.sentAt, message.sentAt);
                return (
                  <div key={message.id}>
                    {showDate && <div className="date-divider"><span>{dateLabel(message.sentAt)}</span></div>}
                    <MessageBubble
                      message={message}
                      mine={message.senderId === session.clientId}
                      grouped={grouped}
                      onRetry={retryMessage}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div ref={endRef} aria-hidden="true" />
        </section>

        {!atBottom && unreadBelow > 0 && (
          <button className="new-message-button" type="button" onClick={() => scrollToLatest()}>
            <ArrowDown size={15} /> {unreadBelow} new {unreadBelow === 1 ? 'message' : 'messages'}
          </button>
        )}

        <div className="typing-line" aria-live="polite">
          {typingNames.length > 0 && (
            <span>
              <i /><i /><i />
              {typingNames.length === 1 ? `${typingNames[0]} is typing` : 'Your partner is typing'}
            </span>
          )}
        </div>

        <footer className="composer-shell">
          <div className="composer">
            <textarea
              id="message-composer"
              aria-label="Message"
              rows={1}
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder={connection.state === 'connected' ? 'Write a message…' : 'Reconnect to send messages'}
              value={draft}
              disabled={connection.state !== 'connected'}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <span className={`character-count${draft.length >= MAX_MESSAGE_LENGTH * 0.9 ? ' is-visible' : ''}`}>
              {draft.length}/{MAX_MESSAGE_LENGTH}
            </span>
            <button
              type="button"
              className="send-button"
              aria-label="Send message"
              title="Send message"
              disabled={connection.state !== 'connected' || !draft.trim()}
              onClick={submitMessage}
            >
              <SendHorizontal size={19} />
            </button>
          </div>
          <p><kbd>Enter</kbd> to send <span>·</span> <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line</p>
        </footer>
      </main>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot>(EMPTY_SNAPSHOT);

  const handleJoin = async (input: {
    displayName: string;
    roomCode: string;
    mode: 'create' | 'join';
  }) => {
    const result: JoinRoomResult = await joinRoom(input);
    savePreference(NAME_STORAGE_KEY, result.displayName);
    savePreference(ROOM_STORAGE_KEY, result.roomCode);
    setSnapshot({ messages: result.messages, participants: result.participants });
    setSession({
      clientId: result.clientId,
      displayName: result.displayName,
      roomCode: result.roomCode,
    });
  };

  const leaveRoom = () => {
    setSession(null);
    setSnapshot(EMPTY_SNAPSHOT);
  };

  return session ? (
    <ChatView session={session} snapshot={snapshot} onLeave={leaveRoom} />
  ) : (
    <Onboarding onJoin={handleJoin} />
  );
}
