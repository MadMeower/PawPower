# Paw Power touchscreen: first hardware test

**Target: Waveshare ESP32-S3-Touch-LCD-4.3B-BOX (SKU 28141).**
Status: ESPHome 2026.10.2 configuration validated; physical hardware test pending.

This folder's test is a standalone USB-powered display/touch check. It contains
no bridge headers, shunt polling or CAN driver. It uses a separate hostname,
`pawpower-screen-test`, so the working bridge can stay online during testing.

## Prepare before the board arrives

1. Download this `touchscreen` branch: Code > Download ZIP.
2. Copy `PawPower-Touch-Test.yaml` from this folder into ESPHome Device Builder's
   configuration folder. This test does not need the files in `firmware/`.
3. Put your private `secrets.yaml` beside the test, with `wifi_ssid`,
   `wifi_password` and `shunt_api_key`. You can use the same secret names you
   already have. A new device can use its own generated API key. Never upload
   the populated secrets file to GitHub.
4. Use ESPHome 2026.10.2 or newer and compile the test. Newer versions still
   require checking; the configuration was validated with 2026.10.2.

## When it arrives

1. Start with only USB connected. Use the supplied/proper USB-C data cable and
   a reliable computer USB supply. Leave all terminal peripherals disconnected.
2. Check the factory screen first if practical, then perform the initial USB
   flash through your local ESPHome Device Builder.
3. If USB is not recognized, follow the board's BOOT/RESET instructions in the
   manufacturer guide linked below. After flashing, reset the board if needed.
4. Expect a green paw with a gold zigzag bolt, `Paw Power`, and a large tap button.
5. Tap the button several times. Its counter should increment; logs also print
   touch coordinates. Check the screen edges for alignment, color and flicker.
6. Report the display result, tap result and logs before adding the bridge.

This uses native LVGL shapes, so no external font or image download is needed.
The paw is a test icon, not the final image logo. The button only changes a
counter and does not send a payment or control equipment.

## Verified hardware map for later integration

| Function | Type-B connection |
|---|---|
| I2C SDA / SCL | GPIO8 / GPIO9 |
| Touch IRQ | GPIO4 |
| Touch reset | CH422G EXIO1 |
| Backlight enable | CH422G EXIO2 |
| RS485 ESP transmit / receive | GPIO44 / GPIO43; automatic direction control |
| CAN ESP transmit / receive | GPIO15 / GPIO16 |
| Memory | 16MB flash, 8MB octal PSRAM |
| Power | USB-C 5V; separate terminal input 7–36V |

**Do not carry over GPIO17/18/21 as RS485 pins from the original bridge.** Those
pins belong to the screen on this board. Do not connect a nominal 48V battery
bank directly to its 7–36V terminal input; continue using the appropriate USB
converter when this leaves the USB bench.

The RGB display preset is named `ESP32-S3-TOUCH-LCD-4.3` in ESPHome. Its LCD
signal pins and dimensions match Waveshare's Type-B pin table; they are listed
explicitly in the test too. This preset's LCD reset defaults to CH422G EXIO3.
Pin-map agreement/configuration validation are not a substitute for the first
hardware test. Pixel clock/panel timing and touch orientation will be checked
on arrival.

## Next steps after the first test passes

Build the Battery page first, then wire up live shunt readings. Share the bridge
core with a separate board entry point after the display and touch work. Only
then test CAN with the inverter. History, Settings and Donut follow one page at
a time. This branch is experimental and is not a replacement for main's
working bridge.

## References

- [Waveshare Type-B specifications and pin map](https://docs.waveshare.com/ESP32-S3-Touch-LCD-4.3B)
- [Waveshare Type-B flashing instructions](https://docs.waveshare.com/ESP32-S3-Touch-LCD-4.3B)
- [ESPHome MIPI RGB driver and example pin map](https://esphome.io/components/display/mipi_rgb/)
- [ESPHome GT911 touch controller](https://esphome.io/components/touchscreen/gt911/)
- [ESPHome CH422G I/O expander](https://esphome.io/components/ch422g/)
