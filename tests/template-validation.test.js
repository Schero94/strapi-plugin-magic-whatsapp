'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('template validation disables save until all server-required fields are valid', async () => {
  const { isTemplateFormValid } = await import('../admin/src/utils/template-validation.mjs');

  assert.equal(isTemplateFormValid({ name: '', language: 'de', body: '' }), false);
  assert.equal(isTemplateFormValid({ name: '   ', language: 'de', body: 'Text' }), false);
  assert.equal(isTemplateFormValid({ name: '!!!', language: 'de', body: 'Text' }), false);
  assert.equal(isTemplateFormValid({ name: 'Login', language: 'de-DE', body: 'Link: {{url}}' }), false);
  assert.equal(isTemplateFormValid({ name: 'Login', language: 'de_DE', body: '   ' }), false);
  assert.equal(isTemplateFormValid({ name: 'Login', language: 'de_DE', body: 'Link: {{url}}' }), true);
});
