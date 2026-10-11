---
name: strapi-plugin-maintenance
description: Maintain the local Magic WhatsApp Strapi 5 plugin, its isolated session and permission-scoped admin UI.
---

# Magic WhatsApp maintenance

Read project rules, retrieve current Strapi 5 Plugin SDK, route and permission documentation with Context7, and compare the pinned version before editing. Do not push. Never store QR codes, phone numbers, message text, credentials or browser auth state in Git or Playwright reports.

This checkout owns WhatsApp transport, connection status, templates and admin actions. Keep auth state in a private ignored folder. Default to disconnected. Pairing and sending must never happen during local smoke tests. Guard all state-changing routes server-side and verify anonymous, restricted and authorized admin outcomes. Use Strapi 5 Design System and Playwright CLI for responsive, keyboard and error-state checks. Run `npm test`, `npm run build`, `npm run verify`, then shared app build/boot and negative-access tests. Record unverified external delivery separately.
