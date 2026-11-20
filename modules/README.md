# PawPower ESP32 modules

Current firmware for three ESP32-S3 boards. Home Assistant and the PawPower cloud server are optional.

| Entry | Hardware / purpose |
| --- | --- |
| PawPower.yaml | Original industrial ESP32-S3: Junctek/WonVon shunt monitoring and Pylontech-style CAN bridge |
| PawPower-Display.yaml | Waveshare ESP32-S3-Touch-LCD-4.3B-BOX: shunt/CAN, LCD controls, SD history and webpage graphs |
| PawPower-Tracer.yaml | Tracer 10415AN monitoring over RS485, with explicit manual Charging On/Off |

Keep the entry YAML and all shared folders together. Public entries use DHCP. When updating an existing installation, retain your own board name, network settings and secrets.

## Setup
1. Copy secrets.yaml.example to your own secrets.yaml, or keep the real file you already have.
2. Set your Wi-Fi and webpage credentials and generate a unique ESPHome API encryption key per board. Example all-A keys and passwords are placeholders.
3. Review board pins, hardware, timezone and the complete battery profile for your installation.
4. Compile/install the selected entry in ESPHome Device Builder 2026.10.2 or later.
5. Open its local webpage using the address reported by your router or Device Builder.

The bundled LCD assets are pet photos used by this firmware. The webpages and Paw Ball run locally. Temperatures are presented in Fahrenheit.

## Standalone and optional cloud
Cloud Uploads defaults Off on new installations. Local monitoring and webpages work without a server. Dummy cloud settings can remain while uploads are Off. Existing installations restore their saved switch value.

To use your own compatible server, configure its HTTPS URL and separate device upload tokens in secrets.yaml, then enable Cloud Uploads. The Android app, server deployment and privileged server credentials are not part of this module snapshot. Never put a Firebase service-account private key in ESP firmware or an Android app. Use your own VPN/Tailscale setup for remote access to local webpages.

## Shunt and inverter controls
Only one board should poll a given live shunt or emulate the CAN battery at a time. Apply a reviewed battery profile before enabling CAN. Charging/discharging SOC limits, voltage/amps requests, temperature holds and fresh-data requirements remain separate protections; the bridge does not replace the battery BMS or inverter protections.

Finish charge permits a one-hour override of PawPower's charging SOC cutoff, with Cancel and automatic expiry. It preserves truthful SOC and other protections. The inverter may still stop for its own settings; this does not guarantee a full charge. Overrides are not resumed after reboot.

Remote app profile changes queue through the optional server and can take about one minute to apply and confirm. Wait for device confirmation rather than treating a queued request as a saved profile.

## Tracer charging commands
Listener mode receives Solar Guardian traffic without transmitting. Disconnect the Wi-Fi dongle and any other master before choosing Poll - no dongle. The selected mode is restored after reboot; first boot listens.

In polling mode, Charging On/Off sends Modbus function 05 to coil 0x0000 (FF00 On, 0000 Off). Commands require an explicit button action; there is no automatic boot write or automatic write retry. The UI reports acknowledgement, rejection or timeout and the reported charging stage. Controller acknowledgement is not proof of power flow or electrical isolation. Verify support and behavior on your own controller. The controller's SOC is diagnostic, not the Junctek shunt's bank SOC.

## History and traffic
Daily energy/peaks are recorded on the ESP even when the phone app is closed. The display adds SD minute CSVs, events, downloads and zoomable daily graphs. Missing samples remain gaps; startup or interrupted coverage is shown as partial. Sudden power loss may lose unsaved recording data. Tracer's detailed graphs cover the current browser session; its daily totals and peaks persist separately.

Cloud snapshots remain every 30 seconds. Idle webpage polls are slower; Tracer pauses requests in hidden tabs. Fast local rendering timers and RS485/CAN traffic are separate from HTTP request counts.

## Validation
Display and Tracer firmware compiled successfully for this checkpoint. Local webpage/command checks and history-copy checks passed. The reported task-stack overflow was addressed by moving large upload/settings packets off task stacks and keeping loop/worker buffers separate. Long-running physical stability and charging behavior still require on-device testing.

From this folder, run the Tracer browser checks with:
`node tests/dashboard-test.cjs`

The C++ files in tests cover decoder matching, energy integration and daily peaks. They use POSIX time helpers; run them in a compatible native environment. Shared webpage and hardware changes are coordinated: update the folders together.

Public snapshot of local checkpoint 970a034. Private secrets, local LAN addressing, Device Builder data, build products and old archives are excluded. See the repository's LICENSE.
