'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const manifest = JSON.parse(readFileSync(new URL('../package.json', `file://${__filename}`), 'utf8'));

test('Magic WhatsApp remains npm-private but can be installed from its GitHub repository', () => {
  assert.equal(manifest.private, true);
  assert.equal(manifest.repository?.url, 'https://github.com/Schero94/strapi-plugin-magic-whatsapp.git');
  assert.equal(manifest.scripts.prepare, 'npm run build');
});
