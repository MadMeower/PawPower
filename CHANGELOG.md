# Changelog

## Shared touchscreen firmware — 2026-11-06

- Split board entry YAMLs from common shunt polling, settings, CAN, history and web dashboard.
- Added Waveshare 4.3B hardware and LVGL packages, Cookie photo, Battery / Controls / History / Settings navigation, two settings pages and numeric keypad.
- Unified validated profile writes across web and touchscreen; saved profiles and histories remain device-local.
- Added explicit dark keypad styling and clearer seasonal wording.
- Removed large history copies from the screen-refresh stack; enabled PSRAM-backed standard allocation on the display after decoded startup/JSON-allocation crashes. Owner reports the allocation fix stopped the crash; long-duration testing remains pending.
- Both entry configurations passed ESPHome 2026.10.2 validation/source generation before the latest UI tweaks. Native tests covered profile persistence/control, live values, stale clearing, histories and stack-frame reduction. Owner compiled and ran the display build. Display RS485/CAN and the shared-core migration on the original board still require hardware commissioning.
- Public templates use DHCP and secret references; no private credentials or generated firmware are included.


## Chasing the Sun — 2026-11-05

- Added a compact annual seasonal dial, countdown and daylight-direction label below battery energy totals.
- Uses the browser clock and America/Detroit calendar date, independently of shunt/CAN status. Updates on date changes without an external service.
- Calendar guide uses June 21 / December 21, explicitly approximate; it is not astronomical timing or a PV forecast.
- Added Node regression checks for turnarounds, year rollover, leap years, marker placement and Michigan midnight. Browser rendering still needs owner review.
- Only the embedded webpage JavaScript changes; control logic and settings storage remain unchanged. Rebuild/upload firmware to update its embedded dashboard.

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
