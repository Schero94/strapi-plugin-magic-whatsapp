'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createWhatsAppService } = require('../server/src/services/whatsapp');

const TEST_RECIPIENT = '+15555550123';

const makeSocket = (overrides = {}) => {
  const ev = new EventEmitter();
  const calls = [];
  return {
    ev,
    calls,
    end: async () => calls.push({ method: 'end' }),
    logout: async () => calls.push({ method: 'logout' }),
    onWhatsApp: async (phone) => {
      calls.push({ method: 'onWhatsApp', phone });
      return [{ exists: true, jid: `${phone}@s.whatsapp.net` }];
    },
    sendMessage: async (jid, content) => calls.push({ method: 'sendMessage', jid, content }),
    ...overrides,
  };
};

const makeStore = (initial = {}) => {
  const values = structuredClone(initial);
  return {
    get: async ({ key }) => structuredClone(values[key]),
    set: async ({ key, value }) => { values[key] = structuredClone(value); },
  };
};

const makeHarness = ({ socketFactory, initialStore, qrEncoder, connectTimeoutMs = 100 } = {}) => {
  const storeCalls = [];
  const logs = [];
  const sockets = [];
  const factoryCalls = [];
  const store = makeStore(initialStore);
  const defaultSocketFactory = async (options) => {
    factoryCalls.push(options);
    const socket = socketFactory ? await socketFactory(options) : makeSocket();
    sockets.push(socket);
    if (!socketFactory) setImmediate(() => socket.ev.emit('connection.update', { connection: 'open' }));
    return socket;
  };
  const baileys = {
    useMultiFileAuthState: async (directory) => ({
      state: { directory, credentials: 'fake-only' },
      saveCreds: async () => {},
    }),
    Browsers: { ubuntu: (name) => ['fake-linux', name, '0.0.0'] },
    DisconnectReason: { loggedOut: 401, restartRequired: 515 },
    default: defaultSocketFactory,
  };
  const strapi = {
    dirs: { app: { root: '/tmp/magic-whatsapp-test-app' } },
    log: {
      debug: (...args) => logs.push(args),
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
    store: ({ type, name }) => {
      storeCalls.push({ type, name });
      return store;
    },
  };
  const service = createWhatsAppService({
    strapi,
    loadBaileys: async () => baileys,
    socketFactory: defaultSocketFactory,
    authDirectory: {
      directory: '/tmp/private-magic-whatsapp-test/.whatsapp-auth',
      ensure: async () => '/tmp/private-magic-whatsapp-test/.whatsapp-auth',
      clear: async () => {},
    },
    qrEncoder: qrEncoder || (async (value) => `data:image/png;base64,FAKE:${value}`),
    logger: { level: 'silent' },
    connectTimeoutMs,
    reconnectDelays: [],
  });

  return { service, storeCalls, logs, sockets, factoryCalls, strapi };
};

test('starts disconnected and reads only the Magic WhatsApp plugin store', async () => {
  const harness = makeHarness();

  assert.deepEqual(harness.service.getStatus(), {
    state: 'disconnected',
    isConnected: false,
    lastError: null,
  });
  assert.deepEqual(await harness.service.getTemplates(), []);
  assert.deepEqual(harness.storeCalls, [{ type: 'plugin', name: 'magic-whatsapp' }]);
  assert.deepEqual(harness.factoryCalls, []);
});

test('serializes connect attempts through the injected fake socket and persists auth in the isolated directory', async () => {
  const calls = [];
  let releaseOpen;
  const openGate = new Promise((resolve) => { releaseOpen = resolve; });
  const harness = makeHarness({
    socketFactory: async (options) => {
      calls.push(options);
      const socket = makeSocket();
      setImmediate(async () => {
        await openGate;
        socket.ev.emit('connection.update', { connection: 'open' });
      });
      return socket;
    },
  });

  const first = harness.service.connect();
  const second = harness.service.connect();
  assert.equal(harness.service.getStatus().state, 'connecting');
  releaseOpen();

  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(({ state, isConnected }) => ({ state, isConnected })), [
    { state: 'connected', isConnected: true },
    { state: 'connected', isConnected: true },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].auth.credentials, 'fake-only');
  assert.equal(calls[0].auth.directory, '/tmp/private-magic-whatsapp-test/.whatsapp-auth');
  assert.deepEqual(calls[0].browser, ['fake-linux', 'Chrome', '0.0.0']);
  assert.equal(calls[0].syncFullHistory, false);
});

test('returns a QR only to the pairing caller and never adds it to status or logs', async () => {
  const harness = makeHarness({
    socketFactory: async () => {
      const socket = makeSocket();
      setImmediate(() => socket.ev.emit('connection.update', { qr: 'fake-qr-payload' }));
      return socket;
    },
  });

  const result = await harness.service.connect();
  assert.equal(result.state, 'qr_pending');
  assert.equal(result.qrCode, 'data:image/png;base64,FAKE:fake-qr-payload');
  assert.equal(Object.hasOwn(harness.service.getStatus(), 'qrCode'), false);
  assert.equal(JSON.stringify(harness.logs).includes('fake-qr-payload'), false);
  assert.equal(harness.service.getPairingQrCode(), result.qrCode);
});

test('maps socket factory errors to safe status and never logs provider details', async () => {
  const harness = makeHarness({ socketFactory: async () => { throw new Error('credential=private-data'); } });

  await assert.rejects(harness.service.connect(), (error) => {
    assert.equal(error.code, 'TRANSPORT_CONNECT_FAILED');
    assert.equal(error.message, 'WhatsApp could not be connected. Check the provider configuration and try again.');
    assert.equal(error.message.includes('private-data'), false);
    return true;
  });
  assert.deepEqual(harness.service.getStatus(), {
    state: 'error',
    isConnected: false,
    lastError: {
      code: 'TRANSPORT_CONNECT_FAILED',
      message: 'WhatsApp could not be connected. Check the provider configuration and try again.',
    },
  });
  assert.equal(JSON.stringify(harness.logs).includes('private-data'), false);
});

test('disconnects without logging out and reports a sanitized close failure', async () => {
  const harness = makeHarness({
    socketFactory: async () => {
      const socket = makeSocket({ end: async () => { throw new Error('token=not-for-logs'); } });
      setImmediate(() => socket.ev.emit('connection.update', { connection: 'open' }));
      return socket;
    },
  });

  await harness.service.connect();
  await assert.rejects(harness.service.disconnect(), { code: 'TRANSPORT_DISCONNECT_FAILED' });
  assert.deepEqual(harness.sockets[0].calls, []);
  assert.deepEqual(harness.service.getStatus(), {
    state: 'error',
    isConnected: false,
    lastError: {
      code: 'TRANSPORT_DISCONNECT_FAILED',
      message: 'WhatsApp could not be disconnected cleanly. Restart the provider if the problem continues.',
    },
  });
  assert.equal(JSON.stringify(harness.logs).includes('not-for-logs'), false);
});

test('validates recipients and message text before invoking the fake socket', async () => {
  const harness = makeHarness();
  await assert.rejects(harness.service.sendMessage({ recipient: '5551234', text: 'hello' }), { code: 'INVALID_RECIPIENT' });
  await assert.rejects(harness.service.sendMessage({ recipient: TEST_RECIPIENT, text: '' }), { code: 'INVALID_MESSAGE' });
  assert.deepEqual(harness.sockets, []);

  await harness.service.connect();
  await harness.service.sendMessage({ recipient: TEST_RECIPIENT, text: 'Test body from fake only' });
  assert.deepEqual(harness.sockets[0].calls, [{
    method: 'onWhatsApp',
    phone: '15555550123@s.whatsapp.net',
  }, {
    method: 'sendMessage',
    jid: '15555550123@s.whatsapp.net',
    content: { text: 'Test body from fake only' },
  }]);
});

test('validates templates, renders variables and supports create, update, send and delete through the fake socket', async () => {
  const harness = makeHarness();
  const service = harness.service;
  const created = await service.createTemplate({
    id: 'welcome-message',
    name: 'Welcome message',
    language: 'en',
    body: 'Hello {{name}}',
  });

  assert.deepEqual(created, {
    id: 'welcome-message',
    name: 'Welcome message',
    language: 'en',
    body: 'Hello {{name}}',
  });
  assert.deepEqual(await service.getTemplates(), [created]);
  await assert.rejects(
    service.createTemplate({ id: 'welcome-message', name: 'Duplicate', language: 'en', body: 'Body' }),
    { code: 'TEMPLATE_ALREADY_EXISTS' },
  );
  await assert.rejects(
    service.createTemplate({ id: '../outside', name: 'Invalid', language: 'en', body: 'Body' }),
    { code: 'INVALID_TEMPLATE' },
  );

  const updated = await service.updateTemplate('welcome-message', { name: 'Welcome', body: 'Hi {{name}}' });
  assert.equal(updated.name, 'Welcome');
  assert.equal(updated.body, 'Hi {{name}}');
  await assert.rejects(service.sendMessage({ recipient: TEST_RECIPIENT, text: 'send stays disconnected' }), { code: 'NOT_CONNECTED' });

  const ready = makeHarness({
    socketFactory: async () => {
      const readySocket = makeSocket();
      setImmediate(() => readySocket.ev.emit('connection.update', { connection: 'open' }));
      return readySocket;
    },
    initialStore: {
      whatsapp_templates: [{
        id: 'welcome-message', name: 'Welcome', language: 'en', body: 'Hi {{name}}',
      }],
    },
  });
  await ready.service.connect();
  assert.deepEqual(await ready.service.sendTemplateMessage({
    recipient: TEST_RECIPIENT,
    templateId: 'welcome-message',
    variables: { name: 'Ada' },
  }), { sent: true });
  assert.deepEqual(ready.sockets[0].calls.at(-1), {
    method: 'sendMessage',
    jid: '15555550123@s.whatsapp.net',
    content: { text: 'Hi Ada' },
  });

  assert.equal(await service.deleteTemplate('welcome-message'), true);
  assert.deepEqual(await service.getTemplates(), []);
  assert.deepEqual(harness.storeCalls, [{ type: 'plugin', name: 'magic-whatsapp' }]);
});

test('checks WhatsApp registration without returning the queried number or account JID', async () => {
  const harness = makeHarness({
    socketFactory: async () => {
      const socket = makeSocket();
      setImmediate(() => socket.ev.emit('connection.update', { connection: 'open' }));
      return socket;
    },
  });

  await harness.service.connect();
  assert.deepEqual(await harness.service.checkNumber(TEST_RECIPIENT), { exists: true });
  assert.equal(JSON.stringify(harness.sockets[0].calls).includes('15555550123'), true);
});

test('refuses to send to an unregistered number before invoking Baileys sendMessage', async () => {
  const harness = makeHarness({
    socketFactory: async () => {
      const socket = makeSocket({ onWhatsApp: async () => [{ exists: false }] });
      setImmediate(() => socket.ev.emit('connection.update', { connection: 'open' }));
      return socket;
    },
  });

  await harness.service.connect();
  await assert.rejects(harness.service.sendMessage({ recipient: TEST_RECIPIENT, text: 'fake only' }), { code: 'RECIPIENT_NOT_REGISTERED' });
  assert.deepEqual(harness.sockets[0].calls, []);
});

test('Magic Link service contract sends a bounded expiry template through the fake Baileys socket', async () => {
  const harness = makeHarness();
  const loginUrl = 'https://example.test/api/magic-link/login?loginToken=fake-only-token';
  await harness.service.connect();

  const result = await harness.service.sendMagicLink({
    phoneNumber: TEST_RECIPIENT,
    loginUrl,
    expiresInSeconds: 300,
  });

  assert.deepEqual(result, { success: true });
  const sentMessage = harness.sockets[0].calls.find((call) => call.method === 'sendMessage');
  assert.equal(sentMessage.jid, '15555550123@s.whatsapp.net');
  assert.match(sentMessage.content.text, /Dein Login-Link/);
  assert.ok(sentMessage.content.text.includes(loginUrl));
  assert.match(sentMessage.content.text, /5 Minuten/);
  assert.ok(sentMessage.content.text.length <= 4096);
  assert.equal(JSON.stringify(harness.logs).includes(loginUrl), false);
  assert.equal(JSON.stringify(harness.logs).includes('fake-only-token'), false);
  assert.equal(JSON.stringify(harness.logs).includes(TEST_RECIPIENT), false);
});

test('rejects unsafe or unbounded Magic Link payloads before fake transport delivery', async () => {
  const harness = makeHarness();
  await harness.service.connect();
  const base = {
    phoneNumber: TEST_RECIPIENT,
    loginUrl: 'https://example.test/login?token=fake-only',
    expiresInSeconds: 300,
  };

  await assert.rejects(harness.service.sendMagicLink({ ...base, loginUrl: 'javascript:alert(1)' }), { code: 'INVALID_LOGIN_URL' });
  await assert.rejects(harness.service.sendMagicLink({ ...base, loginUrl: `https://example.test/${'x'.repeat(2050)}` }), { code: 'INVALID_LOGIN_URL' });
  await assert.rejects(harness.service.sendMagicLink({ ...base, expiresInSeconds: 0 }), { code: 'INVALID_EXPIRY' });
  await assert.rejects(harness.service.sendMagicLink({ ...base, expiresInSeconds: 86_401 }), { code: 'INVALID_EXPIRY' });
  assert.deepEqual(harness.sockets[0].calls, []);
});

test('reports send failures without logging message text, recipient or provider details', async () => {
  const harness = makeHarness({
    socketFactory: async () => {
      const socket = makeSocket({ sendMessage: async () => { throw new Error('message=private-text token=secret'); } });
      setImmediate(() => socket.ev.emit('connection.update', { connection: 'open' }));
      return socket;
    },
  });

  await harness.service.connect();
  await assert.rejects(harness.service.sendMessage({ recipient: TEST_RECIPIENT, text: 'not logged' }), (error) => {
    assert.equal(error.code, 'TRANSPORT_SEND_FAILED');
    assert.equal(error.message.includes('private-text'), false);
    return true;
  });
  assert.equal(JSON.stringify(harness.logs).includes('secret'), false);
  assert.equal(JSON.stringify(harness.logs).includes('not logged'), false);
  assert.equal(JSON.stringify(harness.logs).includes(TEST_RECIPIENT), false);
});
