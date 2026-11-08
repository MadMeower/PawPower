# Paw Power — 4.3-inch touchscreen

Standalone WonVon/Junctek RS485 battery monitor and Pylontech-style CAN bridge. Home Assistant is not required.

## Choose the board branch

- [esp32-s3](https://github.com/MadMeower/PawPower/tree/esp32-s3): original non-display industrial ESP32-S3 board.
- [display-4.3](https://github.com/MadMeower/PawPower/tree/display-4.3): Waveshare ESP32-S3-Touch-LCD-4.3B-BOX.

This branch builds **PawPower-Display.yaml**. Keep pawpower_shared/ beside that entry. The other board entry is intentionally absent.

## Configure and compile

Create a local secrets.yaml using secrets.yaml.example as a guide. Replace all example values and the dummy API key. Public entries use DHCP. Existing installations should retain their own hostname/network identity. Keep private configuration and build artifacts out of Git.

Compile/install PawPower-Display.yaml in ESPHome Device Builder (2026.10.2 or later). Only one device may poll the live shunt or emulate the CAN battery at a time. Review the complete saved battery profile before enabling CAN. Discharge SOC stop/resume are separate from charging SOC thresholds; voltage protection remains a backup. Match all thresholds and limits to the battery and inverter.

The display adds LVGL pages and SD recording. The SD panel lists files, runs a write/read test, shows partition free space, downloads daily CSVs, and erases files only after typing ERASE. Erasure clears the mounted partition, not other partitions. Logging uses daily PawPower-YYYY-MM-DD.csv files and resumes after space is freed.

## Validation and limits

Both local board configurations compiled successfully. Recorder compiler-evaluated assertions and 13 web interface tests passed. The owner confirmed EG4 AC/battery transfer at discharge SOC thresholds and the SD maintenance interface. A downloaded minute CSV correctly contained missing rows on the bench without shunt readings. Live CSV energy accuracy, restart/full-card recovery, and long-duration logging still need hardware tests. The display branch now includes daily SD power/SOC graphs in the browser; missing readings remain gaps. Both branches include webpage traffic indicators and browser-only Paw Pong with optional sound. The non-display branch has no SD recording or daily graph panel.

Run web tests from this directory with: node --test tests/*.test.cjs

## Latest checkpoint

RS485/CAN activity indicators and browser-only Paw Pong (mouse, touch, keyboard; first to seven; optional paddle/wall/point beeps and synthesized Donut victory meow). The game makes no device requests.

Daily CSV power/SOC graphs with Michigan day boundaries, gap/quality handling and inspection. The hidden cat page now shows Donut with a PayPal donation QR. The screen blanks after 15 minutes without touch and resumes on input. RGB timing remains 16 MHz; 64-byte data cache lines improved reported idle tearing. The 14 MHz trial failed and was reverted.

Validation: 43 JavaScript tests and source generation for both local board entries passed. Earlier graph/traffic revisions had full successful builds; latest game, QR and timeout changes were checked through source generation, not a new full build here. Browser audio, phone QR scan, timeout/wake, long-run display stability and live-data graph behavior require device testing.
