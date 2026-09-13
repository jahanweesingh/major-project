const baseUrl = process.env.CHAT_BASE_URL || 'http://localhost:8080';
const wsBaseUrl = baseUrl.replace(/^http/, 'ws');
const roomId = `SMOKE-${String(Date.now()).slice(-8)}`;
const timeoutMs = 8_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function socketUrl(clientId, displayName) {
  const url = new URL(`/ws/${roomId}`, wsBaseUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('display_name', displayName);
  return url;
}

function waitForEvent(socket, expectedType, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${expectedType}`));
    }, timeoutMs);

    const onMessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (payload.type === expectedType && predicate(payload)) {
        cleanup();
        resolve(payload);
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error(`WebSocket failed while waiting for ${expectedType}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
  });
}

function waitForClose(socket, expectedCode) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for close code ${expectedCode}`));
    }, timeoutMs);
    const onClose = (event) => {
      cleanup();
      if (event.code !== expectedCode) {
        reject(new Error(`Expected close code ${expectedCode}, received ${event.code}`));
        return;
      }
      resolve(event);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('close', onClose);
    };
    socket.addEventListener('close', onClose);
  });
}

async function connect(clientId, displayName) {
  const socket = new WebSocket(socketUrl(clientId, displayName));
  const connected = waitForEvent(socket, 'connected');
  await connected;
  return socket;
}

const health = await fetch(`${baseUrl}/api/health`);
assert(health.ok, `Health endpoint returned ${health.status}`);

const alice = await connect('smoke-alice', 'Alice');
const bob = await connect('smoke-bob', 'Bob');

const aliceClientMessageId = `alice-${Date.now()}`;
const aliceText = 'Hello Bob — Docker delivery check';
const aliceMessage = waitForEvent(
  alice,
  'message',
  (event) => event.message?.client_message_id === aliceClientMessageId,
);
const bobMessage = waitForEvent(
  bob,
  'message',
  (event) => event.message?.client_message_id === aliceClientMessageId,
);
const acknowledgement = waitForEvent(
  alice,
  'message_ack',
  (event) => event.client_message_id === aliceClientMessageId,
);

alice.send(
  JSON.stringify({
    type: 'message',
    text: aliceText,
    client_message_id: aliceClientMessageId,
  }),
);

const [seenByAlice, seenByBob, ack] = await Promise.all([
  aliceMessage,
  bobMessage,
  acknowledgement,
]);
assert(seenByAlice.message.text === aliceText, 'Alice received incorrect text');
assert(seenByBob.message.text === aliceText, 'Bob received incorrect text');
assert(ack.message_id === seenByAlice.message.id, 'Acknowledgement ID did not match');
assert(typeof ack.message_id === 'string', 'Acknowledgement ID was not serialized as a string');

const typingAtAlice = waitForEvent(
  alice,
  'typing',
  (event) => event.client_id === 'smoke-bob' && event.is_typing === true,
);
bob.send(JSON.stringify({ type: 'typing', is_typing: true }));
await typingAtAlice;

const bobClientMessageId = `bob-${Date.now()}`;
const bobText = 'Hello Alice — return path confirmed';
const replyAtAlice = waitForEvent(
  alice,
  'message',
  (event) => event.message?.client_message_id === bobClientMessageId,
);
const replyAtBob = waitForEvent(
  bob,
  'message',
  (event) => event.message?.client_message_id === bobClientMessageId,
);
const bobAcknowledgement = waitForEvent(
  bob,
  'message_ack',
  (event) => event.client_message_id === bobClientMessageId,
);
bob.send(JSON.stringify({
  type: 'message',
  text: bobText,
  client_message_id: bobClientMessageId,
}));
const [replySeenByAlice, replySeenByBob, replyAck] = await Promise.all([
  replyAtAlice,
  replyAtBob,
  bobAcknowledgement,
]);
assert(replySeenByAlice.message.text === bobText, 'Alice received an incorrect reply');
assert(replySeenByBob.message.text === bobText, 'Bob received an incorrect reply');
assert(replyAck.message_id === replySeenByAlice.message.id, 'Reply acknowledgement did not match');

const pong = waitForEvent(alice, 'pong');
alice.send(JSON.stringify({ type: 'ping' }));
await pong;

const historyResponse = await fetch(
  `${baseUrl}/api/rooms/${roomId}/messages?limit=50`,
);
assert(historyResponse.ok, `History endpoint returned ${historyResponse.status}`);
const history = await historyResponse.json();
assert(
  history.messages.some((message) => message.client_message_id === aliceClientMessageId),
  'Alice message was not persisted',
);
assert(
  history.messages.some((message) => message.client_message_id === bobClientMessageId),
  'Bob message was not persisted',
);
assert(
  history.messages.every((message) => typeof message.id === 'string'),
  'History message IDs were not serialized as strings',
);

const third = new WebSocket(socketUrl('smoke-charlie', 'Charlie'));
const thirdClosed = waitForClose(third, 4403);
const roomFull = await waitForEvent(
  third,
  'error',
  (event) => event.code === 'room_full',
);
assert(roomFull.code === 'room_full', 'Third participant was not rejected');
await thirdClosed;

alice.close();
bob.close();
third.close();

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      room_id: roomId,
      checks: [
        'frontend proxy health',
        'two WebSocket participants',
        'bidirectional message broadcasts',
        'sender acknowledgements with string IDs',
        'typing event delivery',
        'ping and pong keepalive',
        'SQLite history persistence',
        'third participant rejected with code 4403',
      ],
    },
    null,
    2,
  ),
);
