"""Receive-only validator for Paw Power's seven-frame legacy Pylontech CAN profile.

Run inside CANgaroo 0.7.0's Python view. No pip packages or firmware changes.
This is a profile checker, not a Pylontech certification or inverter emulator.
"""
import struct
import time

EXPECTED = {0x351: 8, 0x355: 4, 0x356: 6, 0x359: 7, 0x35C: 2, 0x35E: 8, 0x379: 4}
NAMES = {0x351: 'Limits', 0x355: 'SOC / SOH', 0x356: 'Measurements',
         0x359: 'Alarm flags', 0x35C: 'Permissions', 0x35E: 'Brand', 0x379: 'Installed capacity'}
# Match these two values to Battery settings after customizing a profile.
EXPECTED_LIMITS = (56.8, 125.0, 140.0, 48.0)  # charge V, charge A, discharge A, cutoff V
EXPECTED_HOLD_VOLTAGE = 54.0
EXPECTED_CAPACITY_AH = 1120  # Match saved capacity, rounded to nearest whole Ah.
STALE_SECONDS = 3.5


def decode(can_id, data, extended=False, rtr=False, fd=False, dlc=None):
    """Return (format_errors, profile_warnings, decoded_text)."""
    errors, warnings = [], []
    if can_id not in EXPECTED:
        return [], ['Unexpected ID 0x%X (outside this seven-frame profile)' % can_id], ''
    if extended:
        errors.append('Expected standard 11-bit ID, received extended frame')
    if rtr:
        errors.append('Expected data frame, received RTR')
    if fd:
        errors.append('Expected classic CAN, received CAN FD')
    wanted = EXPECTED[can_id]
    if len(data) != wanted or (dlc is not None and dlc != wanted):
        errors.append('Expected DLC %d; reported DLC %s, payload %d bytes' %
                      (wanted, dlc if dlc is not None else len(data), len(data)))
    if errors:
        return errors, warnings, ''
    if can_id == 0x351:
        cv, cc, dc, dv = struct.unpack('<HhhH', data)
        values = (cv / 10.0, cc / 10.0, dc / 10.0, dv / 10.0)
        if cc < 0 or dc < 0:
            errors.append('Current limits must be nonnegative (zero means stop)')
        cv_limit, ca_limit, da_limit, floor = EXPECTED_LIMITS
        supported_profiles = {EXPECTED_LIMITS, (EXPECTED_HOLD_VOLTAGE, 0.0, da_limit, floor),
                              (cv_limit, ca_limit, 0.0, floor), (EXPECTED_HOLD_VOLTAGE, 0.0, 0.0, floor)}
        if values not in supported_profiles:
            warnings.append('Limits differ from supported bridge profiles (normal example %s)' % (EXPECTED_LIMITS,))
        text = 'Charge %.1f V / %.1f A; discharge %.1f A; floor %.1f V' % values
    elif can_id == 0x355:
        soc, soh = struct.unpack('<HH', data)
        if soc > 100 or soh > 100:
            errors.append('SOC/SOH must be 0..100 percent')
        if soh != 100:
            warnings.append('SOH differs from the current bench placeholder of 100 percent')
        text = 'SOC %d%%; SOH %d%% (SOH is an assumed compatibility value)' % (soc, soh)
    elif can_id == 0x356:
        voltage, current, temperature = struct.unpack('<Hhh', data)
        v, a, c = voltage / 100.0, current / 10.0, temperature / 10.0
        if not (40 <= v <= 65 and abs(a) <= 600 and -40 <= c <= 100):
            warnings.append('Measurement outside this bank\'s expected plausibility range')
        text = '%.2f V; %+.1f A (%s); %.1f C / %.1f F; %+.0f W' % (
            v, a, 'charging' if a > 0 else 'discharging' if a < 0 else 'idle',
            c, c * 1.8 + 32, v * a)
    elif can_id == 0x359:
        if data[4] == 0:
            errors.append('Logical pack/module count cannot be zero in this profile')
        if any(data[:4]):
            warnings.append('Protection/alarm flags asserted: ' + data[:4].hex(' ').upper())
        if data[4:] != bytes([1, 0x50, 0x4E]):
            warnings.append('Count/PN marker differs from current bench profile')
        text = 'Protection %02X %02X; alarms %02X %02X; logical packs %d; marker %s' % (
            data[0], data[1], data[2], data[3], data[4], data[5:].decode('ascii', errors='replace'))
    elif can_id == 0x35C:
        flags = data[0]
        if flags & 0x07 or data[1] != 0:
            errors.append('Reserved permission bits/byte must be zero in this profile')
        if data not in (bytes([0xC0, 0]), bytes([0x80, 0]), bytes([0x40, 0]), bytes([0, 0])):
            warnings.append('Permissions include unexpected request/reserved bits')
        text = 'Charge %s; discharge %s; force-charge-1 %s; force-charge-2 %s; full-charge-request %s' % tuple(
            'ON' if flags & bit else 'off' for bit in (0x80, 0x40, 0x20, 0x10, 0x08))
    elif can_id == 0x379:
        capacity, = struct.unpack('<I', data)
        if not 1 <= capacity <= 10000:
            errors.append('Capacity outside Paw Power supported range 1..10000 Ah')
        if capacity != EXPECTED_CAPACITY_AH:
            warnings.append('Capacity differs from EXPECTED_CAPACITY_AH; match saved Battery settings')
        text = 'Installed bank capacity %d Ah' % capacity
    else:
        text = 'Brand ' + repr(data.decode('ascii', errors='replace'))
        if data != b'PYLON   ':
            warnings.append('Brand differs from expected eight bytes PYLON + three spaces')
    return errors, warnings, text


class Validator:
    def __init__(self, now):
        self.started = now
        self.channel = None
        self.rows = {}
        self.bad_frames = 0
        self.total_frames = 0
        self.ignored = set()

    def feed(self, msg, now):
        if not msg.is_rx or getattr(msg, 'bustype', 'CAN') != 'CAN':
            return []
        if msg.id not in EXPECTED:
            key = (msg.interface_id, msg.id)
            if key not in self.ignored:
                self.ignored.add(key)
                return ['NOTE: ignoring non-profile RX ID 0x%X on interface %s' % (msg.id, msg.interface_id)]
            return []
        if self.channel is None:
            self.channel = msg.interface_id
        if msg.interface_id != self.channel:
            return []  # Never combine messages from separate CAN networks.
        self.total_frames += 1
        data = bytes(msg.get_data())
        errors, warnings, text = decode(msg.id, data, msg.extended, msg.rtr, msg.fd, msg.dlc)
        row = self.rows.setdefault(msg.id, {'count': 0, 'valid': 0, 'seen': now,
            'stamp': None, 'text': '', 'errors': [], 'warnings': [], 'notice': None})
        row['count'] += 1
        row['seen'] = now
        if row['stamp'] is not None:
            interval = msg.timestamp - row['stamp']
            if not 0.5 <= interval <= 2.5:
                warnings.append('Arrival interval %.3f s; expected approximately 1 s' % interval)
        row['stamp'] = msg.timestamp
        row['text'], row['errors'], row['warnings'] = text, errors, warnings
        lines = []
        if errors:
            self.bad_frames += 1
        else:
            row['valid'] += 1
            if row['valid'] == 1:
                lines.append('FORMAT OK 0x%03X [%d] %s | %s' % (
                    msg.id, len(data), data.hex(' ').upper(), text))
        notice = (tuple(errors), tuple(warnings))
        if notice != row['notice']:
            lines.extend('FAIL 0x%03X: %s' % (msg.id, e) for e in errors)
            lines.extend('WARN 0x%03X: %s' % (msg.id, w) for w in warnings)
        row['notice'] = notice
        return lines

    def status(self, now):
        if self.bad_frames:
            return 'FAIL: %d malformed frame(s) observed; restart script to clear the test' % self.bad_frames
        missing = [key for key in EXPECTED if key not in self.rows]
        if missing:
            return 'WAIT: missing IDs ' + ', '.join('0x%03X' % k for k in missing)
        stale = [key for key, row in self.rows.items() if now - row['seen'] > STALE_SECONDS]
        if stale:
            return 'STALE: no recent frames for ' + ', '.join('0x%03X' % k for k in stale)
        if any(row['valid'] < 3 for row in self.rows.values()):
            return 'WAIT: collecting at least three valid frames per ID'
        if any(row['warnings'] for row in self.rows.values()):
            return 'FORMAT PASS; PROFILE/TIMING WARNINGS -- inspect warnings below'
        return 'PASS: seven expected formats, plausible readings, matching bridge profile fields and fresh traffic'

    def summary(self, now):
        lines = ['\n--- ' + self.status(now) + ' ---',
                 'Interface %s | RX %d | malformed %d' % (self.channel, self.total_frames, self.bad_frames)]
        for key in EXPECTED:
            row = self.rows.get(key)
            if row:
                lines.append('0x%03X %-13s n=%d age=%.1fs | %s' % (
                    key, NAMES[key], row['count'], max(0, now-row['seen']), row['text'] or 'INVALID'))
                lines.extend('  FAIL: ' + e for e in row['errors'])
                lines.extend('  WARN: ' + w for w in row['warnings'])
        return lines


def run():
    try:
        import cangaroo
    except ImportError:
        print('Open this file in CANgaroo\'s Python view and click Run. No separate Python installation is required by this script.')
        return
    cangaroo.clear_filter()
    cangaroo.enable_tx_echo(False)
    validator = Validator(time.monotonic())
    print('PAW POWER -- Pylontech legacy CAN bench validator')
    print('RECEIVE ONLY. This script sends no CAN messages and changes no inverter settings.')
    print('Start measurement at 500 kbps in NORMAL mode, then enable CAN output.')
    print('Checks OUR seven-frame control profile, not every Pylontech variant or EG4 compatibility.')
    print('SOH=100 and zero BMS alarm bits are bench placeholders, not verified battery health.')
    print('CAN hardware checks CRC. This script checks the received application payloads.')
    last_report = time.monotonic()
    last_status = ''
    while True:
        for msg in cangaroo.receive(timeout=0.25):
            for line in validator.feed(msg, time.monotonic()):
                print(line)
        now = time.monotonic()
        status = validator.status(now)
        if status != last_status or now-last_report >= 10:
            for line in validator.summary(now):
                print(line)
            last_status, last_report = status, now


if __name__ == '__main__':
    run()
