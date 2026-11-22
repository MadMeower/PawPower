# Daily totals webpage fix — 2026-11-21

Both units still had daily totals in their energy history, but their normal ESPHome text-sensor HTTP responses were truncated to 5,119 bytes. The envelope repeats the complete history as both value and state, escaping it twice. Enough saved days exceeded the serializer limit. The pages could not parse the incomplete JSON; Shunt misleadingly reported a clock problem.

The pages now read complete, unwrapped JSON from the authenticated, same-origin GET /paw/energy-history route. A mutex protects the snapshot shared between the main loop and HTTP task. Before the first snapshot, the endpoint returns 503; responses are not cached. The existing web-server authentication and origin guard still apply. The snapshot is refreshed by the existing energy-history template sensor.

Shunt distinguishes loading, history retrieval failure, and an unsynchronized device clock. Previously loaded totals remain visible if a refresh fails. Missing readings remain missing. Shunt refreshes local history every 30 seconds while visible; Tracer retains its existing 60-second history interval.

## Install

Use ESPHome Device Builder to install the updated original PawPower-Display.yaml and PawPower-Tracer.yaml configurations, one at a time. Reload each webpage after installation; use Ctrl+F5 if an old page remains open. Allow up to 15 seconds for the first history snapshot. PawPower.yaml also receives the shared Shunt webpage fix.

No Android app or cloud server update is required for this repair. No history storage layout, saved energy totals, charging controls, or notification rules are changed. Do not install files from the ignored firmware/local-build staging directory.

## Follow-up: Display installation and CAN diagnostics

A read-only connection on November 21 found Display running firmware compiled November 20 at 17:34:43, despite successful OTA uploads of the newer image. Further live diagnostics explicitly reported OTA rollback and an exception/panic reset. Device Builder's mDNS log repeatedly changed from the new configuration hash back to the old hash about six seconds after upload. This is a startup failure, not evidence that the user installed incorrectly.

Offline compilation with -fstack-usage measured Display's generated setup() frame at 7,392 bytes against an 8,192-byte loop task stack. setup() runs on that task and must also call initialization functions, leaving insufficient margin. The live pawpower_shared/display-hardware.yaml now sets esp32.framework.advanced.loop_task_stack_size to 16384. Rollback remains enabled. The updated Display firmware compiled successfully (configuration hash d23d01e7), and inspecting the linked ELF confirmed loop_task_stack is 0x4000 bytes (16,384). Static RAM is 164,943 of 341,760 bytes. This is a measured stack-headroom correction; a successful boot lasting beyond the 60-second confirmation interval is still required to verify the runtime repair. If it still rolls back, capture the early panic with Display's USB serial console.

The same live log showed intermittent CAN transmit failures and recovery. The next build logs total failed transmissions, lost arbitration, bus errors, transmit/receive error counters and pending frames when a failure occurs. This adds diagnostics only; transmission timing, retry policy, queued permission reporting and charge limits are unchanged. These counters need to be collected after installation before assigning a hardware or arbitration cause.

The cloud history date-format buffers were enlarged in both upload packages to 32 bytes to resolve the compiler's truncation warning. A November 22 follow-up also enlarged the separate SD ZIP backup date buffer from 16 to 40 bytes, covering the compiler's full signed-int formatting range (up to 36 bytes including separators and NUL). These are character buffers, not 12-bit/16-bit date fields. Normal date output and history storage formats are unchanged.

## Validation

- Reproduced the 5,119-byte malformed responses with read-only HTTP requests to both live units.
- Confirmed Tracer's live energy sensor still contained valid daily totals.
- Regression cases cover 31 populated days, totals and peaks, missing samples, clock unavailable, hidden tabs, malformed responses, and retained totals after network failure.
- Compile and automated test results are reported with the change; live webpage confirmation requires installing the firmware.
