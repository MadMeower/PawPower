# CAN baseline comparison v3

## Observed failure rate

PawPower-Display-logs(3).txt covers 12:47:04.527–12:49:32.458 on November 22 (147.931 seconds). It contains nine CAN TX diagnostics events: about 3.65 per minute. The failed counter reaches 34 and bus errors reach 79; arbitration losses stay zero. Failures occur on 0x351 (six), 0x356 (two), and 0x35C (one). All nine are real driver/bus errors, not paced-sender deadline failures. REC also reaches 105 in one diagnostic.

Repeated one-second text-sensor prints of the same CAN Output Status are not additional failures. The count above uses diagnostic events and increasing driver failure totals.

## Controlled comparison

The installed v2 pacing has not resolved the issue. V3 restores the actual transmit behavior from local checkpoint 970a034:

- Same normal-mode driver, 500 kbit/s timing, seven-frame TX queue, 10-frame RX queue, frame order/bytes/DLC, single-shot flag, one batch per second and nonblocking enqueue.
- No paced on-loop sender, inter-frame scheduler or high-frequency loop request.
- Existing stale-shunt, disabled-output, reviewed-settings and pending-TX abort behavior remains.
- Current frame generation, charging limits, Finish Charge and date-buffer fix remain.
- Retain diagnostic counters and five-clean-cycle recovery. Completion is checked from the previous batch's empty driver queue and unchanged failure/bus-error counters, rather than assuming queue acceptance proves delivery.

This is a controlled rollback of the transmit method, not a confirmed root-cause fix. Faults are not suppressed or renamed away.

## Install

Device Builder sources already contain the comparison:
pawpower_shared/pylon_transport.h and pawpower_shared/can_tx_cycle.h.

Compile/install Display normally. No Tracer, Android or server update is needed. At startup the log identifies:
`CAN baseline TX v3: original 7-frame queue, 500 kbps, 1 second cycle`

After the first verified batch:
`CAN baseline TX v3: seven-frame batch completed`

Capture a similar 2–3 minute running log without changing wiring or charge settings. Compare failed/bus-error counter increases per minute with v2's nine failures in 147.931 seconds. Cumulative values reset on reboot, so totals from different boots are not directly comparable.

## Verification

ESP32-S3 targeted compile against the installed ESP-IDF 5.5.6 headers; compiler-evaluated checks for pending/completed/failed/cancelled batches, failure-counter rollover and retained recovery criteria. These checks do not replace the owner's full firmware build and live comparison.
