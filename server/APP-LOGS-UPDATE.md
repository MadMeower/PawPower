# App unit logs and webpage Paw Ball speed — 1.1.13 (16)

Upload these three server files in order:

1. [private/device-logs.php](private/device-logs.php) → `/path/to/pawpower-private/device-logs.php`
2. [public/history.php](public/history.php) → `public_html/history.php`
3. [public/device-logs.php](public/device-logs.php) → `public_html/device-logs.php`

Keep the private helper outside public_html. Existing backend.php, saved settings, Firebase credentials and tokens stay in place. No new keys or phone registration are required.

Install current Display and Tracer firmware from your ESPHome configuration folder using your normal OTA workflow. The original non-display Shunt also gets the webpage game speed control, but Display remains the sole Shunt cloud uploader. Enable Cloud Uploads to copy local logs to the app; local recording and webpage downloads continue with cloud support Off.

Install app 1.1.13 over the existing app. Open **Menu → Unit logs**. Choose Shunt or Tracer and a day. Errors/events show the device's retained entries and omitted count; Tracer's Daily readings let you select a reading, inspect timestamps and save the complete daily CSV. Temperatures are Fahrenheit. Refresh is explicit; age indicators continue to age without generating more server requests.

Errors sync with existing 30-second history uploads: today plus one prior day per snapshot. Archived Tracer readings sync from committed hourly blocks, with checksum validation and explicit server acknowledgement before an upload is considered copied. New batches normally appear after about five minutes. Previous hours backfill gradually; a full seven-day initial catch-up can take around 1–2 hours while Cloud Uploads remains On. Closing the phone app does not stop recording or syncing. Empty/unavailable fields and missing minutes are preserved. Server log copies retain today plus the previous six America/Detroit calendar days.

The sync uses the existing authenticated history request, not a new polling loop. Firmware negotiates log support from that response and keeps ordinary history uploads working against older servers until the optional private helper is installed. Unacknowledged archives are retried rather than marked copied. Device tokens can upload only their own unit's data; app tokens read the phone endpoint. The Tracer sync opens its own read-only NVS handle and never changes local archive data. Files and rows are bounded, timestamps/fields/CRC are validated, and the existing upload rate limit is preserved. No privileged server credentials are sent to webpages or embedded in Android.

This also corrects a Tracer startup merge issue in the previous archive implementation: the device's mapping-form on_boot could hide package startup actions. The live configuration now uses a list, and the archive has idempotent interval initialization as a fallback. Generated firmware is checked for initialization, cloud-provider registration and shutdown flush.

Both device webpages have a **Game speed** slider in Paw Ball, matching the app's 1×–3× range. It changes during play, survives New game, and is remembered in that browser. It does not write device settings or send controller commands.

Build/model/web/PHP checks are local. Device firmware has not been flashed automatically and no synthetic live notification was sent. After installation, check the local archive says Recording, allow its first commit, then Refresh Unit logs in the phone app.
