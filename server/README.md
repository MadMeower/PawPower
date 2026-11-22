# Optional PawPower server

PHP 8.4 companion endpoints, notification rules, history, remote settings and silent widget updates. The ESP32 webpages work without this optional cloud service.

## Package status

This directory includes the shared backend helper and companion routes. **The original public `api.php` is not included yet.** These files extend an existing PawPower server; they are not a complete fresh-install package. Keep the working `api.php`, private configuration and service account in place.

## Layout and private files

- Upload `public/*.php` beside the existing `api.php` in your website document root.
- Upload `private/*.php` beside the existing private `backend.php`, outside every website document root.
- Public routes use `PAWPOWER_PRIVATE_DIR` when set, otherwise a sibling `pawpower-private` folder next to the document root. Configure that path for your hosting layout.
- Keep `config.php`, `firebase-service-account.json`, OAuth caches, registered phones, readings and all runtime JSON/lock files private and out of Git. The included ignore rules are defense in depth; inspect staged files before publishing.
- The private `.htaccess` denies Apache access as an extra safeguard. It does not replace storing private files outside the document root.

Do not put service-account credentials in Android, firmware or browser JavaScript. Never upload the repository wholesale into the website document root. Existing authentication and HTTPS requirements still apply.

## Feature instructions

- [Widget updates](WIDGET-UPDATES.md): three new files plus one minute cron job; existing alerts are preserved.
- [Notifications](NOTIFICATIONS.md), [equipment alerts](EQUIPMENT-ALERTS-UPDATE.md) and [webpage alerts](WEBPAGE-ALERTS-UPDATE.md).
- [Battery settings](BATTERY-SETTINGS-UPDATE.md), [custom alert names](CUSTOM-ALERT-NAMES-UPDATE.md) and [app logs](APP-LOGS-UPDATE.md).

Feature notes describe incremental deployments, not a replacement for the missing base API installer.

## Fixture tests

Install Node.js, then from the repository root run `npm install --prefix server/test-tools`. Run these commands individually:

```text
node server/validate-syntax.cjs
node server/run-history-tests.mjs
node server/run-rule-tests.mjs
node server/run-battery-tests.mjs
node server/run-device-log-tests.mjs
node server/run-widget-tests.mjs
```

The PHP 8.4 WebAssembly tests use fixtures and fake HTTP delivery, without server credentials or live FCM sends. Actual phone delivery needs deployment and device testing.
