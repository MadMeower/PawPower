# Custom alert names — app 1.1.12 (15)

Upload these two files in order:

1. `server/private/notification-rules.php` → `/path/to/pawpower-private/notification-rules.php`
2. `server/public/notification-preferences.php` → `public_html/notification-preferences.php`

Keep existing saved JSON settings and private credentials. Do not put private helpers in public_html. These files are in addition to the prior webpage equipment alert update.

Install app 1.1.12 over the existing app. In Notifications, each of the three Custom level cards has an optional Alert name. Save preferences as usual. A blank name uses the default title. The name becomes the push title; the message still includes the actual value and threshold. Names support up to 32 characters and 64 UTF-8 bytes, with no control characters.

Build/install Display firmware from your ESPHome configuration folder to edit names on its Shunt webpage too. Long saves travel as ordered packets within ESPHome’s 255-character text limit, and are assembled into one bounded update before reaching the server. Missing, interleaved or expired packets do not partially save settings. Responses still fit the existing persistent queue buffers. Common webpage assets also apply to Tracer, although its fixed equipment alerts do not have custom rules. Cloud Uploads and Notifications must be On for delivery. No change to the 30-second snapshot cadence.

Older app/device saves preserve names they omit. Explicit blank names clear them. Changing a name does not reset an active alert episode or cause another notification. Notification settings revisions still prevent lost concurrent edits.

App build/lint/unit tests, PHP notification and equipment tests, webpage tests and firmware compilation are checked locally. No synthetic live push or hardware flashing is performed.
