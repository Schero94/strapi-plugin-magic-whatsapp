'use strict';

module.exports = {
  register() {},
  bootstrap() {},
  destroy() {},
  config: { default: {}, validator() {} },
  controllers: {},
  services: { whatsapp: require('./services/whatsapp') },
  routes: { admin: { type: 'admin', routes: [] }, 'content-api': { type: 'content-api', routes: [] } },
};
