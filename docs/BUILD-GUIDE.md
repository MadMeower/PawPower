# Paw Power
## Junctek shunt to EG4 6000XP CAN bridge and local battery dashboard

**Build guide, repository review draft • November 5, 2026**

Paw Power reads a WonVon/Junctek battery shunt over RS485, displays battery information on a local webpage, and sends legacy Pylontech-format CAN messages to an EG4 6000XP. This lets the inverter display shunt-derived state of charge and receive configurable bank-level charging and discharging limits, installed battery capacity, and charging permission based on SOC and the shunt temperature probe.

The project uses an ESP32-S3 industrial board with onboard RS485 and CAN interfaces and ESPHome firmware. No Home Assistant installation is required. The inverter’s Ethernet monitoring dongle remains available for normal monitoring.

**Scope:** this is a shunt-to-CAN bridge, not a cell-monitoring BMS. Individual battery BMS units remain responsible for cell protection. The bridge does not know individual cell voltages, individual battery alarms, or whether one parallel string has disconnected. It must not be represented as manufacturer-approved battery compatibility or Pylontech certification.

This repository starts from the working version 23 archive, with editable cold/hot charging protection, installed-capacity reporting, and the corrected ESPHome text limit. The public template uses hostname `pawpower`, friendly name `Paw Power`, and DHCP. The control logic is unchanged from that archive. Use the current files together.

## Start here: the short version

The build has three connections: **shunt to RS485, ESP32 to USB power, and CAN to the inverter**. The longer sections below are reference material; you do not have to learn the CAN protocol to build it.

1. Gather the ESP32 module, a compatible shunt, USB power, two communications cables and connectors. The USB-CAN adapter is an optional test tool; it does not remain connected in normal use.
2. Copy the seven current firmware files together. Copy `secrets.yaml.example` to `secrets.yaml`, then enter your own Wi-Fi details, unique API encryption key and webpage login.
3. Set the YAML network address for your LAN (or use DHCP), then compile and flash using ESPHome Device Builder.
4. Connect power and the shunt first. Open the webpage and verify voltage, SOC and the current sign.
5. Review Battery settings for your bank, including the cold/hot temperature controls in °F, and click **Apply & save to flash**.
6. Check the CAN wiring/termination, optionally test with USB-CAN, then connect the inverter and verify the live readings and recovery behavior.

**This is still a review draft:** the numbered shunt plug orientation and exact ground connections need the final wiring photos. Use the detailed wiring section before connecting hardware.

### Parts Dave actually used

These are the owner-supplied purchase links, with tracking parameters removed. Listings, sellers and available variants can change. They identify the build parts; they are not a blanket endorsement of every replacement variant.

| Part | Link | Build note |
|---|---|---|
| Original WonVon/Junctek shunt | [B09VGYGPQD](https://www.amazon.com/dp/B09VGYGPQD) | Owner reports no longer available; this is the tested shunt |
| Newer WonVon listing | [B09W2H9FB1](https://www.amazon.com/dp/B09W2H9FB1) | Suggested replacement listing, **not tested with Paw Power**; confirm protocol, port pinout and selected current variant |
| ESP32-S3 RS485/CAN module | [B0FNJX8VGZ](https://www.amazon.com/dp/B0FNJX8VGZ) | Actual purchase link; match board markings, revision and pin map |
| Battery-powered USB adapter | [B0GXDCVWD1](https://www.amazon.com/dp/B0GXDCVWD1) | Actual supply used; owner secured its body using an electrical conduit clamp. Input-voltage rating still needs label verification before recommending it for another bank |
| Modular-plug crimper | [B008UY5WL0](https://www.amazon.com/dp/B008UY5WL0) | Actual crimper used for the four-contact plug |
| Four-contact modular plugs | [B07YZ52LF7](https://www.amazon.com/dp/B07YZ52LF7) | 4P4C handset-style plugs; verify fit and conductor compatibility. These are not ordinary six-position RJ11 plugs |
| Optional printed DIN rail | [MakerWorld: reinforced low-profile DIN rail](https://makerworld.com/en/models/1807039-din-rail-reinforced-low-profile#profileId-1927477) | Owner printed this mounting accessory in PLA; model and print instructions remain with its creator. This is a mounting accessory, not a protective enclosure. |
| PC USB-CAN test adapter | [B0CRB8KXWL](https://www.amazon.com/dp/B0CRB8KXWL) | Optional commissioning tool; Jhoinrch CANable-based adapter used in testing |

Also needed: a USB-C data cable, suitable twisted-pair cable, the inverter-side RJ45 connector/breakout, and appropriate strain relief. Existing tools and cables can be reused where compatible.

### The example secrets file

The `firmware/` directory includes **`secrets.yaml.example`** with obvious placeholders. Copy it to **`secrets.yaml`** beside the firmware YAML and replace every value. The public download must never include a populated secrets.yaml.

The API key placeholder is deliberately invalid so a fresh installation cannot accidentally share a published example encryption key. Generate your own key with Python:

```sh
python -c "import base64,secrets; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

Paste the result into `shunt_api_key`. This key is generated locally, costs nothing, and is separate from the webpage username/password. Existing installations should retain their own working key rather than replacing it on every update.

## 1. What has been tested

The working installation uses a WonVon-branded Junctek-protocol shunt, an ESP32-S3 RS485/CAN industrial board, and an EG4 6000XP. Its example bank is four parallel strings of four series-connected 12.8 V, 280 Ah LiFePO4 batteries: nominal 51.2 V, 1120 Ah. That bank is an example, not a requirement to copy.

| Check | Observed result |
|---|---|
| Read voltage, current, remaining Ah, SOC and temperature | Working |
| Positive charging / negative discharging current | Verified in dashboard and decoded CAN capture |
| Original six CAN message formats and live data | Passed USB-CAN validator |
| Added seventh message, installed capacity (`0x379`) | Encoding checks passed; owner confirmed 6000XP displays 1120 Ah |
| Inverter displays SOC and bridge current limits | Working |
| Change current limit, save, and observe inverter | Working |
| Settings survive restart | Confirmed |
| Unplug shunt communications | CAN pause and subsequent recovery observed |
| Remove ESP32 USB power | 6000XP transferred to AC on the tested installation |
| Restore ESP32 power | Communication and battery operation resumed automatically |
| SOC stop/resume at actual thresholds | End-to-end threshold test still to document |
| Low-voltage cutoff/recovery at actual thresholds | End-to-end threshold test still to document |
| Cold-charge settings displayed in °F and edited | Owner reported working after the Fahrenheit update |
| Cold/hot charge cutoff and hysteresis logic | Native simulations passed; actual inverter threshold tests still to document |
| Settings migration and complete-profile saving | Native/browser-handler simulations passed; retain a backup and verify the installed profile |

### Why the bank is called “48 V”

Four **12.8 V nominal** LiFePO4 batteries in series make **51.2 V nominal**. This is commonly grouped in the **48 V system class**. The dashboard's “48V bank” heading is a system-class label, not the live voltage reading or a charging target.

Series connection adds voltage; parallel connection adds Ah. For this example:

| Connection | Nominal voltage | Capacity |
|---|---:|---:|
| One battery | 12.8 V | 280 Ah |
| Four batteries in series, one string | 51.2 V | 280 Ah |
| Four strings in parallel, 16 batteries total | 51.2 V | 1120 Ah |

Nominal stored energy is about **57.3 kWh** (51.2 × 1120 / 1000). Actual battery voltage changes with charging, discharge and load. Do not use nominal voltage as a charge-voltage setting. A more explicit header description would be “51.2V nominal bank”; this guide does not require a webpage change.

AC fallback requires a suitable AC source and the appropriate inverter configuration. The observed behavior does not establish what every firmware/settings combination will do. Record the tested inverter firmware and operating settings with a public release.

## 2. Parts and tools

| Item | Quantity | Purpose / selection notes |
|---|---:|---|
| Waveshare ESP32-S3-RS485-CAN industrial board, matching the tested pin map | 1 | Onboard CAN and RS485 transceivers; verify exact model and revision before ordering |
| Compatible WonVon/Junctek shunt and measuring module | 1 | Must answer the ASCII `:R50` request used here; same-looking products can differ |
| Regulated 5 V USB supply and USB-C data cable | 1 each | Board power and initial flashing; data-capable cable required for flashing |
| Bank-powered USB supply, optional | 1 | Its DC input rating must exceed the battery bank’s maximum voltage; no direct bank connection to USB |
| Four-position modular cable or breakout matching the actual shunt jack | 1 | Verify contact count and continuity; shunt communications lead |
| RJ45 plug/cable or numbered RJ45 breakout | 1 | CAN connection to the inverter’s battery communications port |
| Twisted-pair cable | As needed | Use one pair for RS485 A/B and one pair for CAN H/L |
| CAN termination | 2 endpoints total | 120 ohms at each physical end; include existing onboard/device resistors in that count |
| CANable-compatible USB-CAN adapter | Optional, recommended | Bench validation; the tested adapter was a Jhoinrch CANable-based unit |
| USB extension, enclosure, strain relief and mounting hardware | As needed | Secure communications and power connections |
| PC with ESPHome Device Builder | 1 | Configure, compile, flash and view logs |
| Multimeter, wire tools and continuity tester | As needed | Verify connector contacts, power and termination |

A bare ESP32-S3 does not provide an RS485 or CAN physical interface by itself. Other boards require suitable transceivers and changes to the pin configuration. Do not wire CAN H/L or RS485 A/B directly to ESP GPIO pins.

Battery power cables, busbars, fuses and disconnects are separate from this low-current communications build. Their sizing is installation-specific. No particular fuse size or fault-current estimate from the prototype installation is a universal project requirement.

## 3. Wiring overview

The shunt measures battery current through its existing high-current connections. Paw Power connects only to the shunt communications interface, its own power supply, and the inverter’s battery CAN interface. Do not reroute high-current wiring through the ESP32 board.

### Shunt to ESP32 RS485

| Shunt label | ESP32 board terminal | Tested custom cable color |
|---|---|---|
| A | RS485 A | Blue |
| B | RS485 B | White/blue |
| GND | RS485-side isolated signal ground, if provided and verified on the exact board | White/brown |
| NC on Link port / +5 V on Display port | Leave insulated and unconnected in this build | Brown |

The cable colors above describe the prototype’s custom cable only. They do not define a universal modular connector pinout. Both shunt ports are labeled B, A and GND; the fourth contact differs between the Link and powered Display ports. Prefer the Link port for the bridge and retain the factory display on its intended port when applicable.

**Numbered shunt pinout is intentionally pending verification.** Before publication, add a close-up connector photo with contacts/latch orientation and numbers, and continuity-check all conductors against the actual unit labels. Do not infer numbering from a cable’s colors or a mirrored socket drawing.

Use the isolated bus-side signal reference specified for the exact board. Do not assume USB ground, CAN-side ground and RS485-side ground are interchangeable. The GND row above is a wiring review item until the exact board and connected reference points are confirmed.

The tested firmware uses:

| Internal function | GPIO |
|---|---:|
| RS485 UART TX | 17 |
| RS485 UART RX | 18 |
| RS485 direction control | 21 |
| CAN TX | 15 |
| CAN RX | 16 |

These GPIO assignments describe the onboard transceiver connections, not extra external wiring. UART settings are 115200 baud, 8 data bits, no parity, 1 stop bit. Keep one active shunt poller: disable Crestron polling if the ESP32 is polling. A passive Crestron listener can continue receiving responses.

### ESP32 CAN to EG4 6000XP

| ESP32 board terminal | 6000XP battery CAN/RS485 RJ45 contact |
|---|---|
| CAN H | Pin 4 |
| CAN L | Pin 5 |

Use the inverter’s **battery communications** jack identified in its manual. An RJ45 connector does not mean Ethernet; do not connect this cable to a network switch or inverter parallel-communications port.

With an ordinary T568B cable, pin 4 is blue and pin 5 is white/blue. Verify continuity to numbered contacts rather than trusting color alone. Leave unused contacts unconnected at the bridge end; avoid an eight-conductor interconnect that unintentionally links unrelated signals. The tested bridge-to-inverter cable uses H and L; follow the specific transceiver/inverter documentation for any additional signal reference or shield requirements.

CAN is classic 500 kbit/s using standard 11-bit IDs. Use 120-ohm termination at both physical ends. With the bus unpowered and verified isolated from power, two parallel terminators normally measure approximately 60 ohms between H and L. Do not add terminators blindly: boards and inverter interfaces may already contain them.

### Power

Use the board’s USB-C input with a regulated 5 V supply. If powering it from the battery bank, use an appropriately protected DC-to-USB converter rated for the full bank voltage range. The Waveshare board’s separate terminal power input is not automatically suitable for a 48 V bank; verify its specified range. The shunt Display port’s auxiliary supply is not the power source for this documented build.

## 4. Install the firmware

1. Back up the current inverter settings and any working ESPHome configuration. Begin with the inverter CAN cable disconnected and CAN output disabled.
2. Copy these files together from `firmware/` into the ESPHome configuration folder:
   - `PawPower.yaml`
   - `dashboard.js`
   - `energy_tracker.h`
   - `disconnect_tracker.h`
   - `battery_settings.h`
   - `pylon_can.h`
   - `pylon_transport.h`
3. Copy the supplied `secrets.yaml.example` to a private `secrets.yaml` in that folder. Replace every placeholder with your own values:

```yaml
wifi_ssid: "YOUR_WIFI_NAME"
wifi_password: "YOUR_WIFI_PASSWORD"
shunt_api_key: "YOUR_UNIQUE_BASE64_32_BYTE_API_KEY"
paw_web_username: "YOUR_CHOSEN_USERNAME"
paw_web_password: "YOUR_LONG_UNIQUE_PASSWORD"
```

The API key is an ESPHome encryption key, not a paid web-service key. Generate a fresh 32-byte random key encoded in Base64; do not use the placeholder literally or reuse the prototype owner’s key. Never publish secrets.yaml.

4. The repository template uses DHCP. Find its address in your router or ESPHome logs. To retain an existing static IP, copy your own `wifi.manual_ip` block into the YAML. Ensure a static address is reserved and unused.
5. Set the timezone for the installation. The example is `America/Detroit`. Calendar-day histories depend on valid synchronized time.
6. Confirm the board and pin map. The firmware targets `esp32-s3-devkitc-1` under ESP-IDF. It owns the native TWAI CAN driver through `pylon_transport.h`; do not add an ESPHome `canbus:` component on the same pins.
7. Check the `Battery Settings Apply` text entity has `max_length: 255`. ESPHome rejects 300; 255 is sufficient for an ordinary complete 16-field save. The current package includes this correction. Then compile through ESPHome Device Builder and complete the initial USB flash. Record the successful ESPHome version for the release. Subsequent updates can use the configured ESPHome OTA service.
8. Open the device’s local IP in a browser, log in, and hard-refresh after a dashboard update. The custom JavaScript is embedded in the firmware.

**Existing installations:** rename the old YAML configuration to `PawPower.yaml`, or replace it with the new file while retaining your local customizations. Do not keep two active YAML configurations for the same ESP32. Changing a filename alone requires no flash. However, this public template also changes the hostname to `pawpower`, friendly name to `Paw Power`, and networking to DHCP. Retain your existing names/static-IP block if you want the same network identity during an upgrade; these settings take effect when flashed.

The archive includes `preview.html` with sample readings; it is not the live monitor. Home Assistant and Bluetooth are not required.

## 5. Verify the shunt before enabling CAN

Paw Power sends `:R50=1,2,1,\r\n` approximately every five seconds. The parser expects a 14-field, checksum-valid `:r50=` reply from device address 1. A different shunt address or protocol needs code changes.

Compare voltage, remaining Ah and temperature against the factory display. Observe actual discharge and charging: discharge must be negative current and charging must be positive. Do not infer the charging sign from a discharge-only test.

The bridge computes SOC as remaining Ah divided by its configured capacity, clamped to 0–100%. This does not calibrate the shunt. Ensure the shunt’s capacity and calibration are sensible too; SOC drift can affect charge-stop behavior.

Place the temperature sensor on a representative battery location. Keep it out of inverter exhaust. Only this one temperature is available. Paw Power now implements configurable **cold and hot charging cutoffs**, described below. These do not independently shut off discharge, and cannot detect a faulty probe that reports a plausible temperature. Individual BMS protections remain necessary.

## 6. Review and save battery settings

A new installation requires a reviewed **Apply & save to flash** before CAN can run. Upgrading from an older 10- or 13-field profile retains its values but also waits for this review/Apply before CAN resumes. Editing a field alone does not activate it. All **16 values** are validated and saved together; the page confirms device state. After Apply, enabled CAN output waits for three fresh valid shunt replies.

| Setting | Code starting value | Meaning |
|---|---:|---|
| Capacity | 1120 Ah | Used for SOC/runtime estimates and transmitted as whole installed-bank Ah on CAN `0x379` |
| Stop charging at | 95% | Charge permission disabled at/above this SOC |
| Resume charging at | 93% | Charge permission restored at/below this SOC |
| Charge voltage | 56.8 V | Advertised charging voltage ceiling |
| Charge-hold voltage | 54.0 V | Advertised while SOC, cold or hot charging hold is active |
| Charge current | 125 A | Total bank charging ceiling |
| Discharge current | 140 A | Total bank discharge ceiling |
| Discharge cutoff | 48.0 V | Discharge disabled at/below this voltage |
| Discharge recovery | 50.8 V | Discharge restored at/above this voltage |
| Low-voltage warning | 49.0 V | Advertised bridge voltage warning threshold |
| Cold-charge protection | Enabled | Enables the low-temperature charging hold |
| Cold charging stop | 35.6°F (2°C) | Charging held at/below this probe temperature |
| Cold charging resume | 41°F (5°C) | Cold hold released at/above this probe temperature |
| High-temperature charge protection | Enabled | Enables the high-temperature charging hold |
| Hot charging stop | 113°F (45°C) | Charging held at/above this probe temperature |
| Hot charging resume | 104°F (40°C) | Hot hold released at/below this probe temperature |

These values describe the source defaults, not a recommendation for every bank. The prototype owner later selected 100% stop SOC. Saved values override code defaults after reboot. Resume SOC must be at least one percentage point below stop SOC.

During any SOC or temperature charge hold, advertised charge current becomes zero and charge permission turns off. The hold-voltage value is not an active float-maintenance stage. Charge voltage is a ceiling; there is no separate hard charge-disable latch triggered at that voltage. No force-charge request is generated. The inverter must honor the advertised controls, and its own settings remain relevant.

Change one setting at a time during commissioning, verify the inverter receives it, then reboot once to verify persistence. The firmware’s allowed ranges only check formatting and consistency; they do not certify settings for a particular battery.

### Temperature protection: settings and behavior

Temperature controls on the webpage use **Fahrenheit**. Shunt readings, stored thresholds and CAN measurements use Celsius internally; the webpage converts automatically. Existing saved cold thresholds retain their meaning after the Fahrenheit update.

Both protections have separate enable/disable controls. Temperature thresholds have no preset minimum/maximum range and accept negative values and one decimal place. **Cold resume must be higher than cold stop; hot resume must be lower than hot stop.** Choose settings that leave a sensible operating temperature band. The shunt-reading plausibility check still accepts only −40°C to 100°C; unrestricted setpoints do not expand the measurement range.

At a temperature hold, CAN continues broadcasting with **zero charge-current limit and charging permission OFF**. Discharge remains subject to the existing low-voltage rules. SOC, cold and hot holds are independent: releasing one does not clear another. The status text identifies the active hold. No force-charge request is generated in this release.

At startup, after settings changes, or after rejected/stale readings, each enabled temperature protection starts held and needs its respective resume condition. For example, a hot stop of 113°F and resume of 104°F will remain held after a restart at 108°F until the probe cools to 104°F or below. This avoids bypassing hysteresis by restarting the ESP32.

This protection uses the single shunt probe; it does not know the coldest/hottest cell in the bank. The bridge asks the 6000XP to inhibit charging and does not physically disconnect other chargers.

### Installed capacity reporting

Set **Capacity** to the entire bank's nominal Ah, not the remaining Ah and not the sum of series-connected battery capacities. Paw Power broadcasts it in standard CAN frame **`0x379`**, four bytes, unsigned 32-bit little endian, at whole-Ah resolution. A fractional setting is rounded to the nearest Ah, half up. For 1120 Ah the payload is `60 04 00 00`.

The owner confirmed that the 6000XP now displays **1120 Ah**, replacing the earlier 50 Ah indication. This is the configured installed capacity, not a capacity test performed by the bridge. Changing Capacity and pressing Apply updates CAN capacity and shunt-derived SOC from fresh readings.

### Saving and updates

Profiles are stored as one versioned, checksummed flash record. An unchanged confirmed profile does not need another write. A failed save does not activate the edited draft. Editing in another browser can make a draft stale; use Reload saved values before retrying.

The current firmware preserves old 10-/13-field values during migration to 16 fields, adds the hot controls at their starting values, and requires Apply. Energy, peak and disconnect-history storage formats are unchanged. Older records remain available for rollback, but older firmware will see the pre-upgrade profile and will not have the new protections.

## 7. Optional USB-CAN bench test

1. Leave the inverter disconnected. Connect board CAN H/L to adapter CAN H/L with correct termination.
2. In CANgaroo, select the actual adapter at 500 kbit/s in normal/active mode. Listen-only mode does not acknowledge transmissions and can cause sender errors. CANable adapters may use candleLight/gs_usb or SLCAN firmware; choose compatible software rather than reflashing unnecessarily.
3. Start capture, then enable CAN output on Paw Power. Its underlying ESPHome switch remains named `CAN Bench Output` for compatibility.
4. Wait for three fresh, valid shunt samples. Seven frames should arrive approximately once per second:

| CAN ID (hex) | Payload bytes | Contents |
|---|---:|---|
| 351 | 8 | Charge voltage/current and discharge current/voltage limits |
| 355 | 4 | Rounded SOC and assumed SOH |
| 356 | 6 | Voltage, signed current and temperature |
| 359 | 7 | Bridge voltage flags, logical pack count and marker |
| 35C | 2 | Charge/discharge permissions |
| 35E | 8 | `PYLON   ` compatibility brand |
| 379 | 4 | Installed bank capacity, unsigned 32-bit little-endian whole Ah |

5. Run the included `pylon_validator.py` in CANgaroo’s Python view. Adjust `EXPECTED_LIMITS`, `EXPECTED_HOLD_VOLTAGE` and `EXPECTED_CAPACITY_AH` if the saved settings differ from the example. Use `tools/pylon_validator.py` from this repository; older validators expect six frames. The current validator checks all seven message formats, freshness and this bridge profile; it is not an inverter emulator or protocol certification.
6. Compare both charging and discharging readings against the live display. CAN current resolution is 0.1 A, voltage 0.01 V, temperature 0.1 C, and SOC is rounded to a whole percentage.
7. Unplug shunt communications. At 15 seconds without good data, hardware CAN transmission pauses and the pending queue is cleared. Reconnect: output can resume after three good samples if still enabled. Manual disable prevents restart. The diagnostic shunt-outage counter uses a separate 20-second threshold.

SOH=100% is a compatibility placeholder. It is not measured battery health. One logical pack is advertised, not the number of physical batteries. Individual BMS alarms are unavailable. Queue acceptance or an “Active” sender label alone does not prove the inverter accepted the data.

## 8. Connect and commission the inverter

1. Preserve a backup of existing inverter settings. Confirm the shunt readings, limits, CAN wiring and termination before connecting the inverter.
2. Select the compatible lithium/Pylontech profile. The prototype worked using lithium brand selection **2**, which appeared blank in its menu. Do not assume that number is identical across firmware versions; verify the correct protocol for the installed inverter.
3. Enable CAN output if needed. Confirm the inverter displays matching SOC, battery voltage, **installed capacity in Ah**, and the intended charging/discharging limits and permissions.
4. Observe actual charging and discharging. Verify that current changes are plausible and permission changes have the intended result.
5. With suitable AC available, perform supervised communications-loss and bridge-power-loss tests. Record the warning, transfer behavior, restart and recovery. The prototype transferred to AC on bridge power loss and returned to battery automatically after recovery.
6. Test temperature controls one at a time as described below, then document actual SOC stop/resume behavior before claiming it has been fully tested. Likewise document low-voltage cutoff/recovery through an appropriate supervised procedure; these thresholds are not established merely by correct CAN formatting.

CAN enable/disable is persisted, with a fresh installation defaulting OFF. After reboot, transmission still waits for confirmed settings and three fresh valid shunt samples. The inverter may show a battery communications warning during flashing or startup.

### Test thermal holds without chilling or heating the batteries

Check the live probe temperature first. Leave unrelated settings alone.

- **Cold hold:** temporarily choose cold stop above the current probe temperature and cold resume above stop. Apply, wait for fresh readings, and check the cold-hold status, zero charge limit, charging permission OFF and actual charging stopped. Restore the intended thresholds; release requires the probe to satisfy cold resume.
- **Hot hold:** temporarily choose hot stop below the current probe temperature and hot resume below stop. Apply and perform the same checks for the hot-hold status. Restore the intended thresholds; release requires the probe to satisfy hot resume.
- In either test, discharge should remain allowed unless the separate low-voltage hold applies. If another SOC/temperature hold is active, clearing the tested hold alone will not permit charging.
- Restore and save the intended final thresholds and enable choices. Reboot once to confirm restoration. Record the observed inverter response before claiming a completed end-to-end cutoff test.

## 9. Dashboard and remote access

The local dashboard includes SOC, voltage, signed current, power, remaining capacity, temperature, the shunt’s time estimate, smoothed discharge runtime, and estimated time to full. The SOC ring changes smoothly from bright green at 90% and above, through yellow-green/orange, to red at 20% and deeper red at 10% and below. Charge/discharge power colors remain green/red independently of the SOC ring. Expand Battery settings for the flash-saved profile and CAN output for active hold status. Estimates depend on present/recent current; they do not predict future sunshine, loads or charge taper.

Daily energy is net flow through the battery shunt, accumulated separately as charged and discharged kWh. It is not total PV generation or whole-house consumption. Daily peak watts and amps are independent maxima, sampled at roughly five-second intervals; short spikes may be missed. Today and previous-day values and a 30-day history are retained. A daylight-saving fallback day can correctly contain more than 24 hours of coverage.

Energy, peaks and device-side disconnect history checkpoint approximately every five minutes when changed. Power loss can lose recent unsaved history; powered-off time cannot be measured. Settings have a separate explicit flash-save path. Keep the included persistence settings; avoid changing the flash-write interval without reviewing these mechanisms.

Shunt loss and webpage loss are different. Browser connection history is local to that browser; firmware shunt history remains on the ESP32. A disconnected webpage does not necessarily mean CAN or shunt polling stopped.

The web login uses HTTP Digest authentication, **not HTTPS**. Keep the device on a trusted local network. For remote viewing, the tested installation uses Tailscale through an always-on LAN computer acting as a subnet router. The ESP32 itself does not run Tailscale. Do not forward its HTTP, API or OTA ports directly to the public internet. Web authentication does not protect the separate OTA service; review OTA authentication before sharing a deployment profile.

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| No shunt readings | Board model, A/B continuity, UART pins, device address, 115200 baud and only one active poller |
| Correct voltage but wrong current sign | Actual charge/discharge conditions and protocol direction field; do not swap CAN wires to change sign |
| CAN send/queue errors or no reception | Active acknowledging peer, 500 kbit/s, H/L wiring, termination and correct adapter firmware/driver |
| CAN waits after startup | Saved/reviewed settings, enable switch, three fresh valid samples and data age |
| Inverter battery communication warning | Correct battery jack, matching protocol, H/L contacts, termination and fresh CAN frames |
| Browser disconnected while logs continue | Browser event-stream/network connection; refresh once and distinguish webpage status from shunt age |
| Energy history missing | Valid SNTP time, correct timezone and sufficient consecutive samples; earlier unrecorded days cannot be reconstructed |
| Temperature unexpectedly warm | Probe placement, especially near inverter exhaust |
| ESPHome rejects `max_length: 300` | Set `Battery Settings Apply` to `max_length: 255`; current package corrected |
| Settings missing, disabled or Save does not behave after update | Copy matching YAML/headers/dashboard, compile/upload, Ctrl+F5, then read the message below the buttons |
| CAN waits after a temperature-feature upgrade | Review the migrated 16-field profile and Apply; an older confirmed profile still needs this upgrade review |
| Cold/hot hold remains inside its stop/resume band | Normal hysteresis; after startup/requalification, reach the relevant resume threshold |
| Inverter still shows 50 Ah | Use current capacity-reporting firmware; verify saved Capacity and CAN `0x379`; refresh inverter/app data. Tested installation now displays 1120 Ah |

## 11. Before publishing this guide

- Confirm exact board model/revision from its label. The actual purchase link is now included above; verify the present listing still matches.
- Confirm the USB adapter input-voltage rating from its label. The newer shunt listing remains an untested replacement.
- Add photographs of both shunt ports and cable ends with unambiguous numbered contacts.
- Verify and document isolated signal-ground connections and actual CAN termination positions.
- Record the successful ESPHome version and inverter firmware/protocol menu selection.
- Add dashboard/inverter screenshots with matching readings and remove private network details from public examples.
- Document actual SOC, low-voltage, cold and hot control threshold tests, and clearly retain any untested items.
- Choose a software license before describing the source as open source. Free to download alone does not grant reuse rights.
- Distribute one clean current release with no secrets, rather than the historical update log as the primary setup instructions.

## References

- Waveshare board documentation: https://docs.waveshare.com/ESP32-S3-RS485-CAN
- Board schematic: https://files.waveshare.com/wiki/ESP32-S3-RS485-CAN/ESP32-S3-RS485-CAN-Schematic.pdf
- EG4 6000XP manual and battery communications pinout: https://eg4electronics.com/wp-content/uploads/2024/04/EG4-6000XP-Manual.pdf
- ESPHome UART: https://esphome.io/components/uart/
- ESPHome web server: https://esphome.io/components/web_server/
- Pylontech legacy CAN reference used during development: https://axelzone.ro/storage/victron/bms-pylontech.pdf

The installed firmware is the authority for implemented behavior. This guide combines source inspection with the prototype owner’s reported physical tests; it does not turn unobserved thresholds into completed tests.
