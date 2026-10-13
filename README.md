# Magic WhatsApp for Strapi 5

Magic WhatsApp is the only plugin in this workbench that owns WhatsApp transport. It manages the connection, permission-scoped messages, and reusable templates. Magic Link can call its internal service to deliver one-time login links.

[Open the full guide](https://schero94.github.io/strapi-plugin-magic-whatsapp/) · [GitHub repository](https://github.com/Schero94/strapi-plugin-magic-whatsapp) · [Releases](https://github.com/Schero94/strapi-plugin-magic-whatsapp/releases)

## Requirements

- Strapi 5.57 or a compatible Strapi 5 release
- Node.js 22
- An administrator role with the relevant Magic WhatsApp permission

The package is available from GitHub, not npm. The npm `private` setting stays enabled. Installing the GitHub dependency runs `prepare` to build the admin and server bundles.

```sh
npm install github:Schero94/strapi-plugin-magic-whatsapp
```

Enable it in `config/plugins.ts`:

```ts
export default () => ({
  'magic-whatsapp': {
    enabled: true,
  },
});
```

Then rebuild the Strapi admin and start the server:

```sh
npm run build
npm run develop
```

## What it does

- Starts disconnected and manages one WhatsApp connection from the Strapi admin.
- Separates permissions for connection status, pairing, templates, and sending.
- Creates, edits, lists, and deletes message templates.
- Checks that a recipient is registered before attempting delivery.
- Exposes an internal `sendMagicLink` service for the Magic Link plugin.

The admin UI displays a pairing QR only to an authorized pairing user. Message text, recipient identifiers, QR data, and provider errors are redacted from logs.

## Connection and storage

Pairing is an administrator action. Open Magic WhatsApp in the Strapi admin, connect the account, and scan its QR with the WhatsApp application. The plugin stores Baileys credentials in its private `.whatsapp-auth` data directory. Keep that directory out of source control and restrict filesystem access to the Strapi process.

Disconnecting the transport does not remove the auth directory. Logging out is a separate administrator action that invalidates the saved session.

## Templates and sending

Templates have a name, language code, and message body. The admin validates required fields before enabling save. Direct and template sends require the send permission. The server validates recipients, bounds message length, checks registration, and applies a shared per-admin rate limit.

## Internal service contract

Magic Link calls the registered `magic-whatsapp` plugin service with `{ phoneNumber, loginUrl, expiresInSeconds }`. The service checks connection state and renders a bounded-expiry login message. It returns a generic failure rather than falling back to email or exposing provider details.

This service is internal to the Strapi plugin integration. It is not a public Content API route.

## API routes

All routes use the Strapi admin API and require an authenticated admin plus the matching plugin permission.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/magic-whatsapp/status` | View status |
| POST | `/magic-whatsapp/connection` | Manage connection |
| DELETE | `/magic-whatsapp/connection` | Manage connection |
| GET | `/magic-whatsapp/connection/qr` | Pair account |
| DELETE | `/magic-whatsapp/connection/session` | Manage connection |
| GET, POST, PUT, DELETE | `/magic-whatsapp/templates` | List or manage templates |
| POST | `/magic-whatsapp/messages` | Send message |
| POST | `/magic-whatsapp/messages/templates` | Send template |

## Development and releases

```sh
npm ci
npm test
npm run verify
npm run build
npm pack --dry-run
```

Conventional Commits drive GitHub release tags and changelogs. The package remains npm-private, so release automation does not publish it to the npm registry.

## License

This repository does not currently include a `LICENSE` file.
