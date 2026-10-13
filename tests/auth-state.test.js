'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, rm, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAuthDirectory } = require('../server/src/services/auth-state');

test('creates a private isolated Baileys auth directory outside the application checkout', async (t) => {
  const appDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'magic-whatsapp-auth-test-'));
  const appRoot = path.join(appDataDirectory, 'strapi-app');
  const auth = createAuthDirectory({ baseDirectory: path.join(appDataDirectory, 'plugin-data') });
  t.after(() => rm(appDataDirectory, { recursive: true, force: true }));

  await auth.ensure();
  const metadata = await stat(auth.directory);
  assert.equal(auth.directory.startsWith(appRoot), false);
  assert.equal(metadata.mode & 0o777, 0o700);
});

test('separates authentication directories between plugin data roots and rejects a symlinked auth directory', async (t) => {
  const appDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'magic-whatsapp-auth-isolation-'));
  t.after(() => rm(appDataDirectory, { recursive: true, force: true }));

  const first = createAuthDirectory({ baseDirectory: path.join(appDataDirectory, 'first') });
  const second = createAuthDirectory({ baseDirectory: path.join(appDataDirectory, 'second') });
  assert.notEqual(first.directory, second.directory);
  await first.ensure();
  await second.ensure();

  const linkRoot = path.join(appDataDirectory, 'linked');
  const externalTarget = path.join(appDataDirectory, 'external');
  const { mkdir, symlink } = require('node:fs/promises');
  await mkdir(linkRoot, { mode: 0o700 });
  await mkdir(externalTarget, { mode: 0o700 });
  await symlink(externalTarget, path.join(linkRoot, '.whatsapp-auth'));
  const linked = createAuthDirectory({ baseDirectory: linkRoot });
  await assert.rejects(linked.ensure(), { code: 'AUTH_STATE_UNAVAILABLE' });
});
