# Paw Power 🐾⚡

ESPHome battery monitor and Junctek shunt-to-Pylontech CAN bridge. **Tested with the EG4 6000XP.**

I wanted to connect my Eco-Worthy batteries, which have no CAN communications, to my 6000XP so I could see battery SOC in its app. I know there are other ways to do it, but wanted to try something of my own. This is how I did it. It also works alongside my earlier WonVon-to-Crestron project, but Paw Power is a standalone solution.

An ESP32-S3 reads the shunt over RS485, serves a local battery dashboard, and sends bank measurements and configurable limits over CAN. **Home Assistant is not required.**

## What it does

- Shows voltage, signed current, power, remaining Ah, SOC, and battery-probe temperature.
- Displays shunt/calculated runtime estimates and time to full.
- Records daily charged/discharged kWh, daily peaks, and disconnect history.
- Provides authenticated web settings, saved in flash.
- Reports capacity and configurable charge/discharge limits through legacy Pylontech-style CAN.
- Offers SOC charge stop/resume, low-voltage discharge control, and configurable cold/hot charge cutoffs with hysteresis. The webpage shows temperature settings in °F.
- Pauses CAN output on stale shunt data and waits for fresh readings before resuming.

The bridge **is not a cell-monitoring BMS**. It has one temperature probe and bank measurements, with no individual cell voltages or individual battery alarms. Individual battery protection remains necessary. Inverter behavior on communication loss varies; test it on your installation.

## Compatibility

| Component | Status |
|---|---|
| Original WonVon/Junctek shunt using the implemented 14-field ASCII reply | Tested |
| ESP32-S3 industrial board with RS485 and CAN, linked in the guide | Tested |
| EG4 6000XP using the matching Pylontech CAN profile | Tested |
| Other shunts or Pylontech-compatible inverters | Not confirmed; protocol, wiring and control behavior must be checked |
| Waveshare ESP32-S3-Touch-LCD-4.3B-BOX | Display, touch, settings and navigation tested; RS485/CAN commissioning pending |

## Start here

Read the [build guide](docs/BUILD-GUIDE.md) for parts, wiring, commissioning, settings and remote access.

1. Copy your chosen entry file (`firmware/PawPower.yaml` or `firmware/PawPower-Display.yaml`) and the complete `firmware/pawpower_shared/` folder into your ESPHome configuration directory. Keep the shared folder intact.
2. Copy `secrets.yaml.example` to `secrets.yaml` and fill in your own values. Generate a unique API encryption key as described in the guide.
3. Review the board/pins, timezone and networking. The public template uses **DHCP**, hostname **`pawpower`**, and friendly name **Paw Power**. Existing users can retain their own name/static-IP block.
4. Compile and flash using ESPHome Device Builder. First verify shunt readings with inverter CAN disconnected.
5. Review the settings for your battery bank, apply/save them, then follow the guide's CAN validation and recovery checks.

Do not copy the example bank's charging limits without checking your own batteries and wiring. This repository contains source, not a precompiled firmware image. The shared configuration requires ESPHome 2026.10.2 or newer; automated full-firmware builds are not yet established.

## Files

| Path | Purpose |
|---|---|
| `firmware/` | Two board entry files and a shared firmware folder |
| `firmware/preview.html` | Browser preview with sample readings, not a live device |
| `docs/BUILD-GUIDE.md` | Detailed draft installation and wiring guide |
| `tools/pylon_validator.py` | Receive-only seven-frame checker for CANgaroo's Python view |
| `CHANGELOG.md` | Repository baseline and changes |

Both entry files now load one shared battery core, CAN transport, history implementation and dashboard. The display adds separate hardware and LVGL packages. Its bottom navigation is Battery / Controls / History / Settings. See [the touchscreen guide](touchscreen/README.md) and [shared firmware guide](firmware/README.md). This branch remains experimental; the original board still needs testing after the shared-core migration.

## Remote access

Keep the device on your LAN. Its webpage authentication does not provide HTTPS. A VPN such as Tailscale through a subnet router can provide remote access without exposing the ESP32 with router port forwarding. See the guide.

## Development and sharing

This is an enthusiast project, not manufacturer-certified battery compatibility. Open an issue with your board revision, ESPHome version, inverter model, sanitized configuration and relevant logs. Never post passwords or encryption keys.

MIT licensed. The tested baseline is the existing version 23 working archive, packaged for GitHub with public network/name defaults. See [CHANGELOG.md](CHANGELOG.md) for validation limits.

