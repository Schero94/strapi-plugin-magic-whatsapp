'use strict';

const path = require('node:path');

module.exports = () => ({
  'magic-whatsapp': {
    enabled: true,
    resolve: path.resolve(__dirname, '../../../..'),
  },
});
