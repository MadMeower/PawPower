# Silent widget updates — app 1.1.14

The transparent 2×1 widget shows battery SOC and signed net battery watts (voltage × amps). It has no icon, background panel, refresh button or ticking clock. Positive power means charging; negative power means discharging. Missing data stays blank and stale readings become gray. Tapping opens PawPower.

## Upload these three files

Keep your existing api.php, backend.php, config.php and Firebase service-account file.

| Local source | Destination on your server |
| --- | --- |
| public/widget-subscription.php | Public website folder, beside api.php |
| private/widget-push.php | Existing private folder, beside backend.php |
| private/widget-dispatch.php | Existing private folder, beside backend.php |

The public endpoint locates the private folder beside the website folder, named pawpower-private. For a different layout, set PAWPOWER_PRIVATE_DIR in the server environment or define PAW_PRIVATE in that endpoint to your existing private directory. Never put a private directory or service-account file inside public_html.

## Add one server cron job

In your hosting control panel, add a PHP CLI cron job running every minute:

    * * * * * /path/to/php84 /path/to/pawpower-private/widget-dispatch.php

Use your hosting provider's PHP 8.4 CLI executable and the actual private-folder path. The command contains no API keys. There is no public URL to trigger sending.

For the existing PawPower hosting layout, the script path is the same private directory already referenced by the other companion endpoints. Select the PHP 8.4 binary offered by your hosting provider; the website PHP version and command-line PHP version can differ.

The dispatcher has a nonblocking lock so overlapping cron runs cannot flood phones. It reads the existing history-pawpower-latest.json snapshot; it does not poll the ESP or modify charging controls. Run it once manually in the hosting terminal to check that it prints counts or a reason such as no_due_widget, no_fresh_battery_upload or push_disabled. Never paste credentials into that command.

## Phone installation

Install app 1.1.14, open it once, then add the PawPower home-screen widget. Existing saved phone credentials are reused; no keys need re-entering. Registration automatically enrolls phones with a widget. Removing the final widget opts the phone out when it can reach the server.

Phones renew the subscription about every six hours through the existing background worker. Subscriptions expire after seven days without renewal. Existing battery-alert preferences are separate; global server push_enabled still controls all Firebase sends.

## Timing and power use

While fresh Display uploads are arriving, the server attempts at most one widget message per subscribed phone per minute. Messages are normal-priority, data-only, collapsed to the latest snapshot, with a two-minute lifetime. They do not create alert banners or sounds. Android may delay delivery during Doze; this is not guaranteed real-time monitoring.

The phone renders the tiny received snapshot directly; it does not make an HTTPS request for every push. A 15-minute WorkManager fallback remains for recovery and subscription renewal. There is no foreground service, constant socket, continuous polling or per-second timer. A single deferred repaint dims stale cached values; Android can defer that job too.

Fresh server upload receipt time is used for ordering. Delayed push messages and slower HTTP responses cannot replace a newer cached sample. Null measurements are not changed into zero. Readings older than two minutes on the server are not republished with a fresh timestamp.

## Privacy and validation

Firebase OAuth and service-account signing reuse backend.php. The existing registered phone token must match before enrollment; callers cannot send arbitrary messages or select another server. Runtime subscriptions store hashes of tokens, not extra copies of tokens. No privileged credential enters the Android app, browser code or GitHub.

Fixture tests cover opt-in/out, authentication, cooldowns, missing/stale values, signed watts, normal-priority data-only payloads and token rotation. Phone tests cover recipient binding, numeric/timestamp validation, delayed messages and alert separation. Actual delivery requires the three files, cron job and new app to be installed.
