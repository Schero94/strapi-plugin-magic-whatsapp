'use strict';

module.exports = {
  register() {},
  bootstrap() {},
  destroy() {},
  config: { default: {}, validator() {} },
  controllers: {},
  services: {},
  routes: { admin: { type: 'admin', routes: [] }, 'content-api': { type: 'content-api', routes: [] } },
};
