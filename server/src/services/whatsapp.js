'use strict';

// Storage and connection ownership live here. Network transport remains
// disabled until the permission-scoped adapter and fake-provider tests land.
module.exports = ({ strapi }) => {
  const store = () => strapi.store({ type: 'plugin', name: 'magic-whatsapp' });

  return {
    getStatus() {
      return { status: 'disconnected', isConnected: false, qrCode: null, lastError: null };
    },
    async getTemplates() {
      return (await store().get({ key: 'whatsapp_templates' })) || {};
    },
  };
};
