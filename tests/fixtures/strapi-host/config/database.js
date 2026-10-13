'use strict';

const path = require('node:path');

module.exports = ({ env }) => ({
  connection: {
    client: 'sqlite',
    connection: { filename: env('DATABASE_FILENAME', path.join(__dirname, '..', '.tmp', 'magic-whatsapp.sqlite')) },
    useNullAsDefault: true,
  },
});
