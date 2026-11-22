# Tracer charging command: acknowledged does not mean stopped

On 2026-11-21, read-only native API logs from the running Tracer showed:
- Charge request sequence 1, requested false (Off), command state 3 (matching write reply received), exception 0.
- Repeated fresh charging status 0x0009: running, Boost stage.
- Fresh PV input approximately 877–895 W and battery charge current approximately 16 A.

The deployed off request therefore did not stop charging. No additional commands were sent during this investigation.

The current transport sends Modbus function 05, coil 0x0000, value 0x0000 for Off and 0xFF00 for On. This agrees with the generic manufacturer B-Series communication document's G1 entry, but that document does not establish support for the specific Tracer10415AN firmware. Its table describes the coil as write-only. Source: https://manuals.plus/m/d0f9f08be06b5125134c3be24d9acc1430dcd4e9e82478df68d451489aaa77fb.pdf (page 18; status bits on pages 4–5).

A matching function-05 reply is not independent proof of charger operation. RS485 request echo must also remain a possible explanation until a wire-level trace or model-specific documentation rules it out. The observations do not establish which explanation applies.

The webpage now distinguishes an acknowledged Off request from an actual stopped state:
- Fresh Float/Boost/Equalization status explicitly says Off not confirmed.
- Missing/stale status says charging stop is not confirmed.
- A fresh not-charging status is reported without claiming the charger is disabled; nighttime and controller limits can also stop charging.

The UI change does not alter coil addresses, values, polling, retries, battery settings, or automatic controls. Installing updated Tracer firmware changes the status wording only. Actual remote disable support remains unresolved and must be verified before relying on this button.
