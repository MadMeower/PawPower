# Shared Paw Power firmware

Copy one board entry YAML and the complete `pawpower_shared` folder into your ESPHome configuration directory. Copy `secrets.yaml.example` to a private `secrets.yaml`, then fill it in. Do not flatten the shared folder.

| Entry file | Board | RS485 | CAN |
|---|---|---|---|
| PawPower.yaml | Original industrial ESP32-S3 board | TX17 / RX18 / DE21 | TX15 / RX16 |
| PawPower-Display.yaml | Waveshare ESP32-S3-Touch-LCD-4.3B-BOX | TX44 / RX43, automatic direction | TX15 / RX16 |

Both public examples use DHCP. Preserve your own hostname and static-IP settings when updating an existing device. Display colors are substitutions in its entry file. Secrets are `wifi_ssid`, `wifi_password`, `shunt_api_key`, `paw_web_username`, `paw_web_password`.

`core.yaml` owns polling, parsing, entities, histories and the HTTP server. The headers contain one shared battery-control implementation. `dashboard.js` is the same webpage for either board. `display-hardware.yaml` and `display-ui.yaml` are only loaded by the display entry.

The display hardware package configures its 16MB flash, 8MB octal PSRAM and standard PSRAM-backed allocation. Do not copy that configuration to the original board without checking its memory hardware. The screen-refresh lambda keeps large history scratch buffers off the task stack.

CAN defaults off on a new device. Review/save the bank profile first. Enable CAN from Controls on the display or from the webpage. Output requires three fresh valid shunt replies; stale data pauses it. Verify the new board with an active USB-CAN peer before connecting the inverter. Use only one ESP poller on the shunt at a time.

Settings and histories stay on each physical ESP32. Source sharing does not copy data between boards. Preference keys and runtime-global IDs are retained; erasing flash or factory reset still clears data. Changes to shared source only affect a device after compiling/uploading that device.

Legacy root-level headers/dashboard and display-prefixed local files are no longer used by these entry files. Keep backups until the migration is tested. No Home Assistant is required.

Validation: ESPHome 2026.10.2 configuration validation and C++ generation passed for both entries before the latest layout/color changes. Native tests covered profiles, control, histories, live display calculations and stale clearing. The owner compiled/flashed the display, confirmed the UI/navigation and reported no further crash after the PSRAM allocation fix. Extended stability, display RS485/CAN and the original-board shared-core migration remain unconfirmed. Temperature graph, settings export/import and donation QR are not implemented.
