# Fallback checkpoint — November 22, 2026

Tag: fallback-2026-11-22-usb-power

- Android app: 1.1.17 (versionCode 20), with the current tall/wide pawprint widget.
- ESPHome: current Display, original Shunt and Tracer source under modules/, including error logs, Tracer reading archive, webpage version footers and 51.2V bank label.
- Display CAN: baseline v3, restoring the original seven-frame send method. Keep the verified replacement USB power source. See [power troubleshooting](modules/TROUBLESHOOTING.md).
- Date formatting: enlarged cloud date buffers and the SD ZIP backup buffer.
- Server companion source, notification rules, history, settings, logs and silent widget updates under server/. The deployed original api.php has not been supplied for this repository.
- Pending work is recorded separately in NEXT-REVISION.md.

## Restore source

Use this tag to retrieve the checkpoint in a separate checkout before replacing a working installation. Restore your own ignored configuration: Firebase google-services.json, ESPHome secrets.yaml, server configuration and signing identity. Private credentials and runtime data are intentionally not in Git.

For ESPHome, keep all modules/ entry files and shared directories together and retain your actual network/secrets. Do not run the original Shunt and Display as simultaneous battery CAN bridges.

For Android, install over the existing app using the same signing identity if preserving that installation's data. The public source uses an example server URL; configure your own installation as described in ANDROID.md.

This is a source fallback, not a device image, SD-card backup, database backup or credential backup.

## Evidence

The owner compiled and installed the Display baseline v3. Targeted ESP32 compile checks and compiler-evaluated CAN receipt/recovery checks passed. Two short replacement-supply captures had no CAN errors with cloud Off and On; long-duration reliability still needs observation. Android assembly/lint and 44 unit tests passed. The webpage regression suite passed 52 tests before this checkpoint.
