# Changelog

## Initial repository baseline — 2026-11-05

Imported the current working ShuntDashboard version 23 source and build-guide draft.

Repository-only setup changes:
- Hostname `pawpower` and friendly name `Paw Power`.
- DHCP replaces the prototype's hardcoded LAN address.
- A placeholder secrets example, MIT license and ignored local credentials/build files.
- Organized firmware, documentation and CAN validator; documented optional PLA DIN rail.

The control logic and persistent settings record formats are unchanged. Existing users should retain their own network/name settings if required.

Reported hardware checks include live shunt data and current sign, CAN profile checking, 1120 Ah capacity display on the 6000XP, editable current limits, saved settings, shunt-loss recovery and ESP32-power-loss recovery. Actual SOC/voltage/thermal threshold tests remain to be documented in the guide. Other inverters are unconfirmed.

The initial repository preparation checks YAML structure/secret references, local include paths, unchanged control sources, JavaScript/Python syntax and known credential patterns. It does not claim a new full ESPHome compilation or new hardware test.
