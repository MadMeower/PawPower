# Paw Power touchscreen edition

Target: **Waveshare ESP32-S3-Touch-LCD-4.3B-BOX**, 800×480, 16MB flash, 8MB octal PSRAM.

The complete configuration is now [firmware/PawPower-Display.yaml](../firmware/PawPower-Display.yaml), using [one shared firmware folder](../firmware/README.md) with the non-display board. `PawPower-Touch-Test.yaml` remains a legacy standalone hardware test; it is not the full battery application.

## Install

1. Download this branch. Copy `firmware/PawPower-Display.yaml` and the complete `firmware/pawpower_shared` folder into your ESPHome configuration folder.
2. Keep your private `secrets.yaml` beside the entry file. Use `firmware/secrets.yaml.example` as a template only.
3. Retain your existing hostname/IP when updating. The public example uses hostname `pawpower-display` and DHCP.
4. Compile/upload with ESPHome 2026.10.2. Use a USB data connection for first installation or recovery. During development, the owner observed OTA uploads not showing the new layout; USB uploads showed it. The precise cause remains unresolved.
5. Test screen navigation and settings on USB first. No shunt attached means unavailable readings. The original bridge can remain running while the display's RS485/CAN terminals are disconnected.
6. Check shunt readings and current sign before enabling CAN, then repeat the USB-CAN bench check. Stop the old ESP poller when moving the shunt connection.

## Screen

Bottom navigation: **Battery / Controls / History / Settings**.

- Battery: SOC, voltage, signed current/power, temperature, remaining capacity and runtime estimates.
- Controls: CAN enable/status and memory/loop diagnostics.
- History: recent daily energy and peaks; the web dashboard holds the fuller history view.
- Settings page 1: ten bank capacity/current/voltage/SOC values.
- Settings page 2: cold/hot protection enable and stop/restart temperatures in °F.
- Numeric entry: dark green page/keys, white numbers, Cancel and Use Value. Save settings validates and commits the full profile; Reload saved discards edits.
- Five paw taps within three seconds open Cookie's Easter egg. Tap the photo to exit. Donation link/QR and Donut's replacement photo are not supplied yet.

The Chrome visual editors do not reliably display the package-based layout. The actual screen is the current reference.

## Hardware

| Function | Connection |
|---|---|
| I2C | SDA8 / SCL9 |
| Touch | IRQ4, CH422G EXIO1 reset |
| LCD backlight | CH422G EXIO2 |
| RS485 | TX44 / RX43, automatic direction |
| CAN | TX15 / RX16, 500 kbps |
| Power | USB-C 5V or specified 7–36V input |

GPIO17/18/21 belong to the LCD on this board, so the original board's UART mapping must not be reused. Do not connect a nominal 48V bank directly to the 7–36V input.

Display, touch, keypad, settings and navigation have been exercised by the owner. The display board's live RS485/CAN integration is still pending. A startup stack-pressure issue and later history JSON allocation abort were addressed by reducing screen-refresh stack use and allowing standard allocations in PSRAM. The owner reports the allocation change stopped the crash; extended testing remains pending.

[Waveshare specifications and pin map](https://docs.waveshare.com/ESP32-S3-Touch-LCD-4.3B)
