'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const plugin = require('../server/src');

test('starts disconnected without send, pairing, or public routes', () => {
  assert.deepEqual(plugin.services, {});
  assert.deepEqual(plugin.routes.admin.routes, []);
  assert.deepEqual(plugin.routes['content-api'].routes, []);
});
