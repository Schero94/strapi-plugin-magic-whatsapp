'use strict';

const { PERMISSIONS } = require('../services/whatsapp');

const protectedRoute = (method, path, handler, permission) => ({
  method,
  path,
  handler: `whatsapp.${handler}`,
  config: {
    policies: [
      'admin::isAuthenticatedAdmin',
      { name: 'admin::hasPermissions', config: { actions: [permission] } },
    ],
  },
});

module.exports = {
  type: 'admin',
  routes: [
    protectedRoute('GET', '/status', 'status', PERMISSIONS.status),
    protectedRoute('POST', '/connection', 'connect', PERMISSIONS.connection),
    protectedRoute('DELETE', '/connection', 'disconnect', PERMISSIONS.connection),
    protectedRoute('GET', '/connection/qr', 'pairingQr', PERMISSIONS.connection),
    protectedRoute('DELETE', '/connection/session', 'logout', PERMISSIONS.connection),
    protectedRoute('GET', '/templates', 'templates', PERMISSIONS.templates),
    protectedRoute('POST', '/templates', 'createTemplate', PERMISSIONS.manageTemplates),
    protectedRoute('PUT', '/templates/:id', 'updateTemplate', PERMISSIONS.manageTemplates),
    protectedRoute('DELETE', '/templates/:id', 'deleteTemplate', PERMISSIONS.manageTemplates),
    protectedRoute('POST', '/messages', 'sendMessage', PERMISSIONS.send),
    protectedRoute('POST', '/messages/templates', 'sendTemplate', PERMISSIONS.send),
  ],
};
