import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const [format, plugin] of [
  ['cjs', require('../dist/server/index.js')],
  ['esm', await import('../dist/server/index.mjs')],
]) {
  const instance = plugin.default || plugin;
  if (typeof instance?.services?.whatsapp !== 'function') {
    throw new Error(`${format} bundle does not expose the WhatsApp service`);
  }
  const service = instance.services.whatsapp({
    strapi: { store: () => ({ get: async () => ({}) }) },
  });
  if (service.getStatus().isConnected !== false) {
    throw new Error(`${format} bundle must start disconnected`);
  }
}
console.log('Magic WhatsApp server bundles load and start disconnected');
