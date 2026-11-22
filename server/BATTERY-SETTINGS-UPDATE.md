# Remote shunt battery settings update
Upload exactly these two files to their matching folders. They share a filename but have different contents.

- server/public/battery-settings.php → your PawPower public_html/battery-settings.php (beside api.php).
- server/private/battery-settings.php → /path/to/pawpower-private/battery-settings.php (beside backend.php).

Do not upload private/battery-settings.php to public_html. No credentials or configuration changes are required. The existing private directory must remain writable for battery-control-state.json; it stores profiles and pending requests, never private keys.

Install the updated Display firmware with ESPHome Device Builder. The original non-display board shares local controls and webpage changes, but remains without cloud uploads. Display remains the single battery uploader. Tracer only needs firmware installation for its collapsible webpage graphs; it cannot consume shunt settings commands.

Install app 1.1.9 (12). Menu → Shunt battery settings is separate from Notifications. Remote settings require the Display's Cloud Uploads switch On and a fresh device report. Load, edit, review, send, then wait for Saved on shunt. Queued is not confirmation. Typical round trip is up to about one minute. Requests expire after two minutes and do not replay after a board restart or local profile change.

The phone sends no inverter commands directly. Firmware validates and saves the complete profile atomically, cancels Finish charge, and requires fresh shunt recovery before resuming CAN. Temperatures in the app are Fahrenheit.
