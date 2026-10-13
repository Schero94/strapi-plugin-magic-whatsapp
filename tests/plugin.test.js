'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const plugin = require('../server/src');
const strapiPackageDirectory = path.dirname(require.resolve('@strapi/strapi/package.json'));
const adminPackageDirectory = path.dirname(require.resolve('@strapi/admin/package.json', { paths: [strapiPackageDirectory] }));
const strapiPoliciesDirectory = path.join(adminPackageDirectory, 'dist/server/server/src/policies');
const isAuthenticatedAdmin = require(path.join(strapiPoliciesDirectory, 'isAuthenticatedAdmin.js'));
const hasPermissions = require(path.join(strapiPoliciesDirectory, 'hasPermissions.js'));

const expectedPermissions = [
  'overview.access',
  'status.view',
  'connection.manage',
  'templates.list',
  'templates.edit',
  'messages.send',
];

test('registers distinct server-side permissions for each privileged capability', async () => {
  const registrations = [];
  const strapi = {
    admin: {
      services: {
        permission: {
          actionProvider: { registerMany: async (actions) => registrations.push(...actions) },
        },
      },
    },
  };

  await plugin.bootstrap({ strapi });
  assert.deepEqual(registrations.map(({ uid }) => uid).sort(), expectedPermissions.sort());
  assert.ok(registrations.every(({ pluginName, section }) => pluginName === 'magic-whatsapp' && section === 'plugins'));
  assert.ok(registrations.every(({ displayName }) => typeof displayName === 'string' && displayName.length > 0));
});

test('protects every admin endpoint with authenticated-admin and capability permission policies', () => {
  const routes = plugin.routes.admin.routes;
  const requiredPolicies = ['admin::isAuthenticatedAdmin', 'admin::hasPermissions'];
  const requiredRoutes = new Map([
    ['GET /status', 'plugin::magic-whatsapp.status.view'],
    ['POST /connection', 'plugin::magic-whatsapp.connection.manage'],
    ['DELETE /connection', 'plugin::magic-whatsapp.connection.manage'],
    ['GET /connection/qr', 'plugin::magic-whatsapp.connection.manage'],
    ['DELETE /connection/session', 'plugin::magic-whatsapp.connection.manage'],
    ['GET /templates', 'plugin::magic-whatsapp.templates.list'],
    ['POST /templates', 'plugin::magic-whatsapp.templates.edit'],
    ['PUT /templates/:id', 'plugin::magic-whatsapp.templates.edit'],
    ['DELETE /templates/:id', 'plugin::magic-whatsapp.templates.edit'],
    ['POST /messages', 'plugin::magic-whatsapp.messages.send'],
    ['POST /messages/templates', 'plugin::magic-whatsapp.messages.send'],
  ]);

  assert.deepEqual(new Set(routes.map(({ method, path }) => `${method} ${path}`)), new Set(requiredRoutes.keys()));
  for (const route of routes) {
    const policies = route.config?.policies || [];
    assert.ok(policies.includes(requiredPolicies[0]), `${route.method} ${route.path} must require admin authentication`);
    const permissionPolicy = policies.find((policy) => typeof policy === 'object' && policy.name === 'admin::hasPermissions');
    assert.ok(permissionPolicy, `${route.method} ${route.path} must require server-side permission checks`);
    assert.deepEqual(permissionPolicy?.config?.actions, [requiredRoutes.get(`${route.method} ${route.path}`)]);
    assert.notEqual(route.config.auth, false, `${route.method} ${route.path} must not be public`);
  }
});

test('Strapi 5.57 admin policies deny anonymous and restricted admins, and allow the scoped action', () => {
  for (const route of plugin.routes.admin.routes) {
    const requiredAction = route.config.policies
      .find((policy) => typeof policy === 'object' && policy.name === 'admin::hasPermissions')
      .config.actions[0];
    assert.equal(isAuthenticatedAdmin({ state: { isAuthenticated: false } }), false, `${route.method} ${route.path} denies anonymous callers`);
    assert.equal(isAuthenticatedAdmin({ state: { isAuthenticated: true } }), true, `${route.method} ${route.path} accepts an authenticated admin`);

    const deniedContext = { state: { userAbility: { can: () => false } } };
    assert.equal(hasPermissions.handler(deniedContext, { actions: [requiredAction] }), false, `${route.method} ${route.path} denies an admin without its scoped action`);

    const allowedContext = { state: { userAbility: { can: (action) => action === requiredAction } } };
    assert.equal(hasPermissions.handler(allowedContext, { actions: [requiredAction] }), true, `${route.method} ${route.path} permits its scoped action`);
  }
});

test('keeps plugin actions and WhatsApp transports out of the public content API', () => {
  assert.deepEqual(plugin.routes['content-api'].routes, []);
  assert.equal(typeof plugin.services.whatsapp, 'function');
  const controller = plugin.controllers.whatsapp({ strapi: {} });
  assert.equal(typeof controller.status, 'function');
  assert.equal(typeof controller.sendMessage, 'function');
});

test('routes Magic Link provider calls through the registered internal service and fake transport', async () => {
  const calls = [];
  const socket = {
    ev: new EventEmitter(),
    onWhatsApp: async (jid) => [{ exists: true, jid }],
    sendMessage: async (jid, content) => calls.push({ method: 'sendMessage', jid, content }),
    end: async () => {},
  };
  let socketFactoryCalls = 0;
  const strapi = {
    dirs: { app: { root: '/tmp/magic-whatsapp-registry-test' } },
    store: () => ({ get: async () => [], set: async () => {} }),
  };
  const service = plugin.services.whatsapp({ strapi }, {
    loadBaileys: async () => ({
      useMultiFileAuthState: async () => ({ state: {}, saveCreds: async () => {} }),
      Browsers: { ubuntu: (name) => ['fake-linux', name, '0.0.0'] },
      default: async () => {
        socketFactoryCalls += 1;
        setImmediate(() => socket.ev.emit('connection.update', { connection: 'open' }));
        return socket;
      },
    }),
    authDirectory: {
      directory: '/tmp/magic-whatsapp-registry-test/.whatsapp-auth',
      ensure: async () => '/tmp/magic-whatsapp-registry-test/.whatsapp-auth',
      clear: async () => {},
    },
    logger: { level: 'silent' },
    connectTimeoutMs: 100,
    reconnectDelays: [],
  });

  assert.equal(typeof service.getStatus, 'function');
  assert.equal(typeof service.sendMagicLink, 'function');
  assert.equal(service.getStatus().state, 'disconnected');
  assert.equal(socketFactoryCalls, 0, 'plugin creation must not connect to WhatsApp');

  const connection = await service.connect();
  assert.equal(connection.state, 'connected');
  assert.equal(service.getStatus().state, 'connected');
  const result = await service.sendMagicLink({
    phoneNumber: '+15555550123',
    loginUrl: 'https://example.test/api/magic-link/login?loginToken=fake-only',
    expiresInSeconds: 300,
  });

  assert.deepEqual(result, { success: true });
  assert.equal(socketFactoryCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].jid, '15555550123@s.whatsapp.net');
  assert.match(calls[0].content.text, /https:\/\/example\.test\/api\/magic-link\/login\?loginToken=fake-only/);
  assert.match(calls[0].content.text, /5 Minuten/);
  await service.shutdown();
});

test('rejects unsupported provider configuration instead of accepting unsafe options', () => {
  assert.throws(() => plugin.config.validator({ socketFactory: 'not-a-factory' }), /socketFactory must be a function/);
  assert.throws(() => plugin.config.validator({ authDirectory: '/tmp/shared-auth' }), /unsupported options/);
  assert.doesNotThrow(() => plugin.config.validator({ socketFactory: null }));
});
