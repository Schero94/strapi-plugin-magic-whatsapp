'use strict';

module.exports = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  { name: 'strapi::favicon', config: { path: '/dev/null', maxAge: 0 } },
  'strapi::public',
];
