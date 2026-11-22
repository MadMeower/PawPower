# Local error history and Tracer daily readings

Update the relevant ESPHome firmware from this folder using the usual OTA installation. No app or PHP/server update is required for these local webpage features. The non-display Shunt is included through shared core.yaml.

## Android app access
App 1.1.13 adds Menu → Unit logs for Shunt/Tracer events and Tracer one-minute readings, with day selection and CSV export. It reads authenticated server copies, so viewing works remotely without entering device webpage passwords. Cloud Uploads must be On for syncing; local recording stays independent. The server update instructions are in the Android project at server/APP-LOGS-UPDATE.md. Ordinary uploads continue against an older server until log support is advertised. New readings normally sync after a five-minute commit; older hours backfill gradually. The live Tracer configuration and archive package now also protect archive startup against ESPHome package boot-action overrides.

## Error log — every unit
Open the collapsed **Error log · seven days** section on the unit webpage, select a day, and choose Show / refresh or Download CSV. It retains today and the previous six local calendar days, with the latest 32 entries per day. If that limit is exceeded the page reports how many older entries were omitted. This is structured fault/recovery history, not the raw console log.

Recorded observations include startup/reset reason, Wi-Fi loss/recovery, missing/stale Shunt or Tracer readings, CAN communication errors, Tracer charging-status faults and Modbus exception summaries, manual charging-command outcomes, and enabled cloud upload/alert/history failures. Tracer archive failures are also logged. Normal nighttime no-input status is excluded from controller faults. Unknown/stale fault status is not treated as recovery. The existing CAN heartbeat receiver cannot provide the 6000XP's internal fault codes.

Logs begin with this firmware. Startup time is the time startup was observed after a valid clock became available. Brief events before the clock is available cannot be dated. No timestamps or events are invented. Clock rollback pauses new dated writes. Repeated unchanged fault states are not repeated.

The compact error history is restored from preferences. It is checkpointed about every five minutes; abrupt power loss may lose the latest events. Console text, credentials, API tokens and server response bodies are never copied into this log.

## Tracer — one-minute readings, seven days
Open **Daily readings · seven days** on the Tracer webpage. Recording runs on the ESP32 while the webpage is closed and Cloud Uploads is Off. Select a day and Download day CSV. Today is partial; logs start after installing this firmware and obtaining a valid clock. Existing daily totals/peaks retain their separate 31-day history.

Each snapshot records solar watts, panel volts/amps, battery volts/amps, battery-probe temperature and controller temperature. Snapshot times are actual observation times, not minute averages. CSV times are UTC and temperature columns are Fahrenheit. Stale, unavailable or invalid fields are blank; quality is fresh, partial or missing. Unrecorded minutes stay absent, with no interpolation or zero filling. The controller's probe value is recorded as reported; the firmware cannot infer whether a physical probe is connected.

Storage uses compact hourly blobs in the dedicated paw_readings namespace of the existing NVS storage partition. The current generated Tracer partition table provides 448 KiB, sufficient for the seven-day archive. No partition table, bootloader, OTA slot, battery settings or credentials are rewritten. There is no formatting operation. Runtime checks disable the archive on an installed layout with insufficient space, and writes reserve free entries for normal preferences. A board with an older smaller layout reports that clearly instead of erasing or repartitioning it.

Snapshots are committed in batches about every five minutes and on normal shutdown when possible. Sudden power loss can lose the latest buffered batch. The webpage shows the last committed sample, buffered count and samples not saved since restart. Current buffered samples can be included in a download before commit. Expired archive keys are removed only from the archive namespace once the clock is valid. Calendar boundaries follow the configured America/Detroit timezone, including 23/25-hour DST days.

An independent low-priority worker performs NVS operations. The bus loop only queues small snapshots. Exports read short pages with matching request tokens and offsets; missing files are gaps while checksum/read failures stop the download. No partial CSV is saved after cancellation or failure. Closed log sections make no polling requests, and downloads use only the authenticated same-origin device endpoints.

## Local validation

Display, Tracer and the original non-display Shunt compile successfully with ESPHome 2026.11.0 / ESP-IDF 5.5.6. All 45 webpage tests pass. Native models cover error deduplication, persistence, retention/clock rollback, hourly archive checksums, immutable minutes, stale fields and Fahrenheit CSV conversion. Web tests cover full-day paging, 23/25-hour days, wrong-request responses, storage-unavailable reporting and rejection of partial downloads. Physical units have not been flashed by the assistant.

## After installing
Allow about one minute for the first snapshots, then open Daily readings and Refresh status. It should say Recording. After roughly five minutes, Last committed sample should advance. Download today's CSV to inspect the first data; the log grows as the unit runs. Persistent flash behavior and long-running retention should also be verified on the physical unit after installation.
