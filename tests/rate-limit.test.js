'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createController = require('../server/src/controllers/whatsapp');
const { createSendRateLimiter } = require('../server/src/services/send-rate-limiter');

const makeContext = (service, userId, body = {}) => ({
  params: {},
  request: { body },
  state: { user: { id: userId } },
  strapi: { plugin: () => ({ service: () => service }) },
});

test('shares a per-admin send limit across direct and template routes and releases it after the window', async () => {
  let now = 1_000;
  const limiter = createSendRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });
  const deliveries = [];
  const service = {
    sendMessage: async (message) => deliveries.push({ kind: 'direct', message }),
    sendTemplateMessage: async (message) => deliveries.push({ kind: 'template', message }),
  };
  const strapi = { plugin: () => ({ service: () => service }) };
  const controller = createController({ strapi, sendRateLimiter: limiter });

  const first = makeContext(service, 'admin-one', { recipient: '+15555550123', text: 'fake direct' });
  const second = makeContext(service, 'admin-one', { recipient: '+15555550123', templateId: 'test', variables: {} });
  const blocked = makeContext(service, 'admin-one', { recipient: '+15555550123', text: 'third fake send' });

  await controller.sendMessage(first);
  await controller.sendTemplate(second);
  await controller.sendMessage(blocked);
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  assert.equal(JSON.stringify(blocked.body).includes('third fake send'), false);
  assert.equal(deliveries.length, 2);

  const otherAdmin = makeContext(service, 'admin-two', { recipient: '+15555550123', text: 'fake other admin' });
  await controller.sendMessage(otherAdmin);
  assert.equal(otherAdmin.status, 202);

  now += 60_000;
  const afterWindow = makeContext(service, 'admin-one', { recipient: '+15555550123', text: 'fake after window' });
  await controller.sendMessage(afterWindow);
  assert.equal(afterWindow.status, 202);
  assert.equal(deliveries.length, 4);
});
