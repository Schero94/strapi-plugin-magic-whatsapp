export const permissions = {
  overview: [{ action: 'plugin::magic-whatsapp.overview.access' }],
  status: [{ action: 'plugin::magic-whatsapp.status.view' }],
  connection: [{ action: 'plugin::magic-whatsapp.connection.manage' }],
  templates: [{ action: 'plugin::magic-whatsapp.templates.list' }],
  editTemplates: [{ action: 'plugin::magic-whatsapp.templates.edit' }],
  send: [{ action: 'plugin::magic-whatsapp.messages.send' }],
};

export const permissionChecks = [
  ...permissions.overview,
  ...permissions.status,
  ...permissions.connection,
  ...permissions.templates,
  ...permissions.editTemplates,
  ...permissions.send,
];
