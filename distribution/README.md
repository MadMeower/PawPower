# Private phone updates

Firebase App Distribution delivers private PawPower test builds without hosting an APK on your website.

## Receive updates

Use the Google-account email invited to this app. Open Firebase's invitation on your phone, accept access,
then download/install the build. Android may ask you to allow installation from the tester app/browser.
Install over the existing app; do not uninstall it. Firebase App Tester can keep your private builds together.
A notification/email announces an available build; installation still needs your approval on the phone.

## Send the next update

1. Increase versionCode in app/build.gradle.kts for each new update. Keep versionName and release-notes.txt current.
2. Keep your existing local debug signing key at ~/.android/debug.keystore. This private test channel uses the same
   debug signing identity as Android Studio Run, so it can update the existing installation and retain its saved settings.
3. Ensure Firebase CLI is signed in: npx.cmd -y firebase-tools@latest login
4. Run from PowerShell: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\distribution\Send-Update.ps1

This execution-policy option applies only to that process; it does not change the computer's saved policy.
The script builds/checks the app and uploads app/build/outputs/apk/debug/app-debug.apk to the existing Firebase
app identified in your local google-services.json. If Android Studio has already built and checked the APK,
append -SkipBuild to the command instead. Use -CheckOnly to validate configuration without uploading.

The first private release, 1.1.0 (3), was uploaded and distributed successfully on November 16, 2026.
Phone installation still needs to be confirmed.

Recipient addresses live in distribution/testers.local.txt, which is ignored by Git.
Signing keystores, Firebase CLI debug logs, and google-services.json are also ignored.
No password, Firebase refresh token, server admin token or service-account key belongs in this script or the Android app.

These are private development builds, not a public Play Store release. Keep the signing key backed up privately.
Moving to production release signing later needs a separate migration plan; don't switch keys for an ordinary update.

Official instructions: https://firebase.google.com/docs/app-distribution/android/distribute-cli
