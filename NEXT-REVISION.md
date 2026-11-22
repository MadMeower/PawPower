# Next PawPower revision

## Widget appearance

- Make the pawprint larger in both 2x1 and 1x2 layouts, preserving legible SOC/watts and the transparent background.
- Increase paw opacity by approximately 20% relative to the current 0.35 alpha: target 0.42.
- Keep tall-widget SOC near the top and watts near the bottom, unsigned watt text, direction colors and stale styling.
- Deferred until the next app revision; no new build/distribution for this note.

## Tracer charging stop review

- Revisit reliable manual charging On/Off on the EPEVER Tracer10415AN before adding automatic SOC/voltage control.
- Current implementation is Modbus function 05, coil 0x0000, Off=0x0000 and On=0xFF00.
- Earlier device observations showed an acknowledged Off request while fresh Boost status, approximately 880 W PV and approximately 16 A charging continued. It is not a verified charging disable.
- Confirm model/firmware-specific command support and distinguish a controller reply from possible RS485 echo. A successful write reply alone is insufficient.
- Read back current configuration and preserve existing values before any future parameter-writing experiment.
- The previously suggested 0x901B temperature-limit workaround remains unverified and has not been implemented. It changes a protection setting; do not present it as a normal verified charging switch.
- Verify actual fresh watts/amps and status during any explicitly requested live test; nighttime zero production does not prove charging was disabled.
- No controller commands or register writes were sent during this review.

See [Tracer charging observations](modules/TRACER-CHARGE-STATUS.md).
