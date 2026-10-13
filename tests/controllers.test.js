'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createController = require('../server/src/controllers/whatsapp');

const makeContext = (service, body) => ({
  params: {},
  request: { body },
  strapi: { plugin: () => ({ service: () => service }) },
});

test('returns safe validation responses without echoing invalid request data', async () => {
  const service = { sendMessage: async () => { throw Object.assign(new Error('secret recipient and message'), { code: 'INVALID_RECIPIENT' }); } };
  const ctx = makeContext(service, { recipient: 'private-number', text: 'private-message' });
  const controller = createController({ strapi: ctx.strapi });

  await controller.sendMessage(ctx);
  assert.equal(ctx.status, 400);
  assert.deepEqual(ctx.body, {
    error: { code: 'INVALID_RECIPIENT', message: 'Enter a valid international phone number.' },
  });
  assert.equal(JSON.stringify(ctx.body).includes('private-number'), false);
  assert.equal(JSON.stringify(ctx.body).includes('private-message'), false);
});

test('maps unknown provider errors to a fixed response and never returns raw errors', async () => {
  const service = { connect: async () => { throw new Error('credential=private-token phone=private-number'); } };
  const ctx = makeContext(service, undefined);
  const controller = createController({ strapi: ctx.strapi });

  await controller.connect(ctx);
  assert.equal(ctx.status, 502);
  assert.deepEqual(ctx.body, {
    error: {
      code: 'TRANSPORT_CONNECT_FAILED',
      message: 'WhatsApp could not be connected. Check the provider configuration and try again.',
    },
  });
  assert.equal(JSON.stringify(ctx.body).includes('private-token'), false);
  assert.equal(JSON.stringify(ctx.body).includes('private-number'), false);
});
