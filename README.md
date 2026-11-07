# Paw Power — non-display ESP32-S3

Standalone WonVon/Junctek RS485 battery monitor and Pylontech-style CAN bridge. Home Assistant is not required.

## Choose the board branch

- [esp32-s3](https://github.com/MadMeower/PawPower/tree/esp32-s3): original non-display industrial ESP32-S3 board.
- [display-4.3](https://github.com/MadMeower/PawPower/tree/display-4.3): Waveshare ESP32-S3-Touch-LCD-4.3B-BOX.

This branch builds **PawPower.yaml**. Keep pawpower_shared/ beside that entry. The other board entry is intentionally absent.

## Configure and compile

Create a local secrets.yaml using secrets.yaml.example as a guide. Replace all example values and the dummy API key. Public entries use DHCP. Existing installations should retain their own hostname/network identity. Keep private configuration and build artifacts out of Git.

Compile/install PawPower.yaml in ESPHome Device Builder (2026.10.2 or later). Only one device may poll the live shunt or emulate the CAN battery at a time. Review the complete saved battery profile before enabling CAN. Discharge SOC stop/resume are separate from charging SOC thresholds; voltage protection remains a backup. Match all thresholds and limits to the battery and inverter.

## Validation and limits

Both local board configurations compiled successfully. Recorder compiler-evaluated assertions and 13 web interface tests passed. The owner confirmed EG4 AC/battery transfer at discharge SOC thresholds and the SD maintenance interface. A downloaded minute CSV correctly contained missing rows on the bench without shunt readings. Live CSV energy accuracy, restart/full-card recovery, and long-duration logging still need hardware tests. Graphs are not implemented yet.

Run web tests from this directory with: node --test tests/sd_diagnostics_web.test.cjs
