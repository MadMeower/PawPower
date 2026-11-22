# App logs update validation

- Android 1.1.13 (16): debug APK build, lint and 38 unit tests passed.
- Webpages: 48 tests passed, including live speed changes, remembered speed, blocked localStorage, log exports and protection against incomplete/mixed responses.
- PHP 8.4: device-log authentication/roles, archive CRC/field validation, seven-day bounds, replay and legacy uploads passed. Existing history/energy/gap, notification, equipment-alert and test-push endpoint regressions passed.
- ESPHome 2026.11.0 / ESP-IDF 5.5.6: Display, Tracer and original non-display Shunt compiled.
- Generated Tracer code is checked for archive initialization, cloud provider registration and normal-shutdown flush. Display startup still includes settings initialization.

No physical firmware was flashed and no synthetic live push was sent. Actual cloud log delivery is ready for testing after uploading the three files in APP-LOGS-UPDATE.md and installing firmware. The local recording startup correction is included in this update. Ordinary uploads remain compatible with a server that has not enabled log support yet.
