'use strict';

const { chmod, lstat, mkdir, rm } = require('node:fs/promises');
const path = require('node:path');

const createAuthStateError = () => {
  const error = new Error('WhatsApp authentication storage is unavailable.');
  error.code = 'AUTH_STATE_UNAVAILABLE';
  return error;
};

const createAuthDirectory = ({ baseDirectory } = {}) => {
  if (typeof baseDirectory !== 'string' || !path.isAbsolute(baseDirectory)) {
    throw new TypeError('The WhatsApp auth-state base directory must be absolute.');
  }

  const directory = path.join(path.resolve(baseDirectory), '.whatsapp-auth');

  return {
    directory,

    async ensure() {
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const metadata = await lstat(directory);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw createAuthStateError();
        await chmod(directory, 0o700);
        return directory;
      } catch (error) {
        if (error.code === 'AUTH_STATE_UNAVAILABLE') throw error;
        throw createAuthStateError();
      }
    },

    async clear() {
      try {
        const metadata = await lstat(directory);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw createAuthStateError();
        await rm(directory, { recursive: true, force: false });
      } catch (error) {
        if (error.code === 'ENOENT') return;
        if (error.code === 'AUTH_STATE_UNAVAILABLE') throw error;
        throw createAuthStateError();
      }
    },
  };
};

module.exports = { createAuthDirectory };
