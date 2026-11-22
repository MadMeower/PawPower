# CAN troubleshooting: check USB power before changing firmware

## Frequent transmit errors with otherwise working readings

A marginal USB power supply, USB cable or power/reference path can produce frequent CAN transmit errors even while the LCD, Wi-Fi, shunt readings and incoming inverter heartbeats appear to work. Receiving heartbeats alone does not prove that the transmit side is healthy.

For the Waveshare ESP32-S3-Touch-LCD-4.3B, USB-C power is **5V**. See the [manufacturer specifications](https://docs.waveshare.com/ESP32-S3-Touch-LCD-4.3B).

Before repeatedly rebuilding firmware:

1. Save a short running log and note the current firmware and wiring.
2. Substitute a known-good USB supply, keeping the firmware, CAN wiring and USB cable unchanged where practical. If changing the cable too, record that both changed.
3. Compare actual increases in `failed` and `bus_errors` over a similar time window. Repeated status lines are not additional errors; one error burst may include several failed frames. Counters from separate boots cannot be compared as if continuous.
4. Once communication is clean, repeat under the normal workload, including cloud uploads if used. Observe for longer before treating the issue as resolved.

This is a diagnostic test, not proof that every CAN fault comes from USB power. If errors remain, continue checking documented pinouts, CAN termination, connections, interference, bitrate and driver behavior. Do not hide recurring faults by disabling their reports.

## Observed Display case — November 22, 2026

The Display intermittently received valid 6000XP heartbeats while showing several real transmit failures per minute. Changing CAN pacing and temporarily disabling cloud uploads did not eliminate them. The baseline sender also failed, so the symptoms were not explained by the paced sender alone.

After replacing the USB power source/path, the supplied logs showed:

| Test | Captured duration | Result |
| --- | --- | --- |
| Replacement supply, cloud support Off | About 115 seconds | No CAN errors logged; transmission activity continued and 89 inverter heartbeats arrived |
| Replacement supply, cloud support On | About 83 seconds | No CAN errors logged; transmission activity continued, 63 inverter heartbeats arrived, and uploads/history/alert checks succeeded |

The two clean captures strongly implicated the original USB power source/path. They did not measure supply ripple or identify a failed component, and were not a long-duration reliability test. A further firmware change was not required after the clean captures.

## Keep the interfaces separate

The shunt-to-Display connection is RS-485. The Display-to-inverter connection is CAN. CAN transport errors are not automatically internal inverter fault codes.

Use the inverter's own documented communication pinout. The [6000XP manual, section 6.6.2](https://eg4electronics.com/wp-content/uploads/2024/04/EG4-6000XP-Manual.pdf#page=21) identifies CAN H on pin 4 and CAN L on pin 5; its table does not identify a CAN ground pin. Do not connect a ground wire to an unverified spare pin.
