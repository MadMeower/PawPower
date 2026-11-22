# Shared battery notification preferences

The Android Preferences screen and the display webpage edit one server-saved set of battery rules.
No additional keys are needed: Android uses its saved app token; the display uses its existing battery device token.
Existing api.php, backend.php and config.php stay in place.

## Install and test one step at a time

1. Upload public/notification-preferences.php and public/device-monitor.php beside api.php.
2. Upload private/notification-rules.php and private/notification-settings.php to /path/to/pawpower-private, beside backend.php. Do not expose this private directory through the website.
3. Open Preferences in the updated Android app. Reload from server. All rules and Phone alerts initially default off. Set levels for your battery, save with alerts off, and reload to confirm persistence.
4. Compile/install your existing PawPower-Display.yaml in ESPHome Device Builder. The updated sources are already in your ESPHome configuration folder: cloud_upload/battery.yaml, cloud_upload/cloud_uploader.h, pawpower_common/web_assets.h and pawpower_shared/dashboard.js. No Tracer firmware update is needed for these battery rules.
5. Refresh the display webpage and open Preferences. It should load the same saved levels. Change one level, save, then reload Android Preferences to confirm sharing. Conflicting edits require a reload and cannot overwrite a newer revision.
6. Confirm Cloud Uploads is on. Use the existing manual notification test first. Then enable Phone alerts and one SOC rule. For a controlled test, set its low threshold slightly above the current SOC and wait the confirmation delay plus up to two 30-second samples. Restore the desired threshold afterward. No battery, charger or CAN settings need changing.

## Rules and behavior

- Individual enabled switches and thresholds: low voltage, low SOC, low temperature, high temperature, danger high temperature, charging current and full SOC.
- Three custom rules can use voltage, SOC, temperature or signed current, at or above/below a chosen level.
- Temperatures display in Fahrenheit in preferences and messages, with automatic Celsius conversion for stored thresholds; positive current means charging. Full is a user-defined SOC level, not charger/BMS full certification.
- Confirmation delay is adjustable from 30 to 600 seconds, default 60.
- Fresh measurements are sampled every 30 seconds. Missing/invalid readings and gaps over 90 seconds reset pending confirmation. Old readings never cause new alerts.
- A successful notification latches that episode until recovery beyond 0.3 V, 2% SOC, 3.6°F or 0.3 A. Failed sends retry at most every five minutes while the condition remains active. If some phones accept a send, it is latched to avoid repeating it to those phones.
- Danger-temperature events take priority when several rules become active together.
- Cloud Uploads off pauses monitoring uploads and automatic checks. The display still synchronizes preferences. Manual test notifications are independent.
- Saved preferences and episode state live in private JSON files created by the existing backend helpers. They survive device/server restarts. No scheduled job or open Android app is required; fresh display uploads drive evaluation.
- Internet, server push enablement, phone registration, Android notification permission and fresh display readings are required.
- Preferences only affect notifications, never battery protection or charging controls.

## Validation

Android assembleDebug, lintDebug and the preference/notification regression tests passed. See ../FEATURE-UPDATES.md for current feature validation.
Display ESPHome configuration validation passed; firmware was not compiled or flashed.
The PHP 8.4 WebAssembly runner tests rule behavior plus endpoint authentication, shared persistence,
conflicts and latching using mock storage/push helpers. It sends no live FCM messages.
Web tests cover the command codec, validation, existing switch persistence and manual-test handling.

Run locally:
- node server/run-rule-tests.mjs
- node server/validate-syntax.cjs
- node --test firmware/web/notification-test.test.cjs firmware/web/device-preferences.test.cjs firmware/web/alert-preferences.test.cjs

PHP test dependencies are ignored under server/test-tools. Reinstall if needed:
npm.cmd install --prefix server/test-tools --no-save --package-lock=false @php-wasm/node php-parser

Live delivery of these new automatic rules still requires the server upload and display installation above.
