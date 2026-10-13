'use strict';

const serviceFactory = require('./services/whatsapp');

const permissionActions = [
  { section: 'plugins', displayName: 'Open WhatsApp overview', uid: 'overview.access', pluginName: 'magic-whatsapp' },
  { section: 'plugins', displayName: 'Read WhatsApp connection status', uid: 'status.view', pluginName: 'magic-whatsapp' },
  { section: 'plugins', displayName: 'Manage WhatsApp connection and session', uid: 'connection.manage', pluginName: 'magic-whatsapp' },
  { section: 'plugins', displayName: 'List WhatsApp templates', uid: 'templates.list', pluginName: 'magic-whatsapp' },
  { section: 'plugins', displayName: 'Edit WhatsApp templates', uid: 'templates.edit', pluginName: 'magic-whatsapp' },
  { section: 'plugins', displayName: 'Send WhatsApp messages', uid: 'messages.send', pluginName: 'magic-whatsapp' },
];

module.exports = {
  register() {},

  async bootstrap({ strapi }) {
    const actionProvider = strapi.admin?.services?.permission?.actionProvider;
    if (typeof actionProvider?.registerMany !== 'function') {
      throw new Error('Strapi admin permission action provider is not available.');
    }
    await actionProvider.registerMany(permissionActions);
  },

  async destroy({ strapi }) {
    const service = strapi.plugin?.('magic-whatsapp')?.service?.('whatsapp');
    if (typeof service?.shutdown === 'function') await service.shutdown();
  },

  config: {
    default: { socketFactory: null },
    validator(config) {
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new TypeError('Magic WhatsApp configuration must be an object.');
      }
      if (config.socketFactory !== null && config.socketFactory !== undefined && typeof config.socketFactory !== 'function') {
        throw new TypeError('Magic WhatsApp socketFactory must be a function.');
      }
      const unsupportedKeys = Object.keys(config).filter((key) => key !== 'socketFactory');
      if (unsupportedKeys.length > 0) throw new TypeError('Magic WhatsApp configuration contains unsupported options.');
    },
  },

  controllers: { whatsapp: require('./controllers/whatsapp') },
  services: { whatsapp: serviceFactory },
  routes: {
    admin: require('./routes/admin'),
    'content-api': { type: 'content-api', routes: [] },
  },
};
