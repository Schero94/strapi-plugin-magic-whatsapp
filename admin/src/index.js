import { PuzzlePiece } from '@strapi/icons';

import { permissions } from './permissions';

const PLUGIN_ID = 'magic-whatsapp';

export default {
  register(app) {
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: PuzzlePiece,
      intlLabel: { id: `${PLUGIN_ID}.plugin.name`, defaultMessage: 'WhatsApp' },
      Component: () => import('./pages/App'),
      permissions: permissions.overview,
    });
    app.registerPlugin({ id: PLUGIN_ID, name: 'Magic WhatsApp', isReady: true });
  },
  bootstrap() {},
};
