'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('standalone transport starts disconnected and never reads the Magic-Mail store', async () => {
  const calls = [];
  const strapi = {
    dirs: { app: { root: '/tmp/magic-whatsapp-fixture' } },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    store: ({ type, name }) => {
      calls.push({ type, name });
      return { get: async () => ({}), set: async () => {} };
    },
  };
  const transport = require('../server/src/services/whatsapp')({ strapi });
  assert.equal(transport.getStatus().isConnected, false);
  assert.deepEqual(await transport.getTemplates(), {});
  assert.deepEqual(calls, [{ type: 'plugin', name: 'magic-whatsapp' }]);
});
