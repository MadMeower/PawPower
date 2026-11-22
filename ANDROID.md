# Android source checkpoint — PawPower 1.1.17

The Kotlin Android app is in app/, using package com.madmeower.pawpower and minimum API 26. Open this repository root in Android Studio. Gradle wrapper files are included.

## Configure your installation

1. Create your own Firebase Android app for this package and place its downloaded google-services.json in app/. This file is intentionally ignored.
2. Replace the example HTTPS service base URL in the Kotlin sources with your own compatible PawPower server URL. Public source uses https://your-server.example; local owner settings are not published.
3. Build/run the app. Enter the app credential for your own server using the app setup flow. Do not embed an app/admin/device token or service-account private key in source.
4. For private tester distribution, create distribution/testers.local.txt and authenticate Firebase CLI for your own project. Send-Update.ps1 reads your local Firebase configuration and recipient file. Signing keys and recipient lists remain private.

For cloud setup, see [server/](server/README.md). The original api.php is still required and is not included in this companion package. ESP32 local monitoring works independently of the Android app/server.

## Checkpoint features

App 1.1.17 includes Shunt/Tracer dashboards, graphs/history, notifications/preferences, unit logs, Paw Ball/Donut and a transparent pawprint home-screen widget. Resize the widget to 2x1 or 1x2. Tall layout places SOC at the top and unsigned net battery watts at the bottom; green/red indicate charging/discharging and gray indicates stale data.

Best-effort minute widget pushes require the [server widget files and cron job](server/WIDGET-UPDATES.md). They reuse phone registration and remain separate from alert banners.

The larger, 20%-more-opaque widget paw and further Tracer shutdown investigation are pending in [NEXT-REVISION.md](NEXT-REVISION.md); they are not part of this checkpoint.

## Validation

The installed 1.1.17 build passed assembly, lint and 44 unit tests before this source checkpoint. Public copies change the owner server address to an example address and require your own Firebase configuration; live functionality depends on your configured backend. No build or installation is needed just to save this fallback.
