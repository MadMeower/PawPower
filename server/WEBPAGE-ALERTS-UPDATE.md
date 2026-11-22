# Webpage alerts update — app 1.1.11 (14)

For an installation already running the equipment-alerts update, upload these two changed files in order:

1. `server/private/equipment-alerts.php` → `/path/to/pawpower-private/equipment-alerts.php`
2. `server/public/equipment-preferences.php` → `public_html/equipment-preferences.php`

For a first installation also follow EQUIPMENT-ALERTS-UPDATE.md for device-monitor.php and history.php. Keep existing private credentials and tokens unchanged.

Build/install Display and Tracer using the current your ESPHome configuration folder sources. No firmware was flashed automatically. Reload the device webpages after installing.

Display/Shunt Preferences retains all battery notification settings and adds a 6000XP CAN notifications section. Tracer has its own notification section for faults and high controller/battery-probe temperatures, shown in Fahrenheit. The Tracer Notifications master is explicitly shared with Shunt and the app. Actual internal 6000XP fault codes are unavailable with the current heartbeat-only CAN receiver.

Both webpages edit the same server settings as the app. Device tokens stay inside firmware, not browser code. Device-specific routes reject the other board's fields. Saving checks revisions to avoid overwriting another editor. Changes may take up to one minute to apply and confirm. Cloud Uploads must be On. Collapsed/hidden equipment panels do not poll; open idle panels refresh once per minute. Snapshot uploads remain every 30 seconds.

The app hides healthy CAN/controller messages while retaining real errors and stale/unknown warnings. Tracer now includes a local paw favicon and its existing header paw.
