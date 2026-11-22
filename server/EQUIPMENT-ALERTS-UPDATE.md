# Equipment alerts and app 1.1.10 (13)

## Server upload order
Upload the private helper first, followed by the three public endpoints:
1. server/private/equipment-alerts.php → /path/to/pawpower-private/equipment-alerts.php
2. server/public/equipment-preferences.php → public_html/equipment-preferences.php
3. server/public/device-monitor.php → public_html/device-monitor.php
4. server/public/history.php → public_html/history.php

Do not put the private helper in public_html. Existing backend.php, Firebase credentials and tokens remain unchanged. No credentials belong in these files or in GitHub.

## Firmware
Build/install PawPower-Display and PawPower-Tracer from the existing your ESPHome configuration folder sources. Cloud Uploads must be On for remote readings and alerts. Firmware sends diagnostics through the same 30-second snapshot cadence. Tracer now uses device-monitor.php with its own device token; that is one additional alert-evaluation request per snapshot. The display still uses its existing monitor request. Fault flags reach the app through the history metadata request it already makes.

The Tracer reads existing charging status register 3201 and uploads it only while fresh; it also uploads fresh controller and battery-probe temperatures. Normal nighttime no-input status is not a fault. Unsupported or stale status is unknown, not a normal reading. The controller family protocol is documented at https://www.img4.cz/i4wifi/attach/StoItem/7124/MODBUS-Protocol-v25.pdf .

The 6000XP is connected only by battery CAN. The bridge can report its own CAN initialization/status/bus-off/transmission errors. It cannot decode the inverter's internal fault codes from the current heartbeat-only receiver. Preferences and notifications explicitly call these CAN communication errors. Actual inverter fault reporting requires a supported additional diagnostic source; no fault bits are guessed.

## App
Install app 1.1.10 (13) over the current app. Notifications → Equipment alerts has separate options for:
- Tracer controller faults
- 6000XP CAN communication errors
- High Tracer controller temperature
- High Tracer battery-probe temperature

Temperature thresholds are Fahrenheit. All options default Off. The existing Notifications master must also be On, server push enabled, and phone permission allowed. Equipment confirmation delay is 30–600 seconds. An accepted event is latched until recovery; missing telemetry is not recovery. Failed sends retry no faster than five minutes. Temperature recovery requires dropping more than 3.6°F below the threshold.

The dashboard flags current equipment alerts even if notification options are Off. Stale status is marked stale. Swipe left/right between Shunt and Tracer; tabs still work. The tagline moves to the footer. Tap a Donut cameo for a fullscreen photo and the existing donation QR (https://paypal.me/DonutMeow). The QR is generated locally; opening the donation link requires a tap.

App and webpage preferences now explain that changes may take up to one minute to apply and confirm.

## Validation
Android build/unit tests/lint, PHP rule and endpoint tests, native telemetry checks and firmware compilation are used for this update. No synthetic fault or notification was sent to the production server, and Codex did not flash hardware. Physical fault behavior and long-running stability must be checked on the devices after installation.
