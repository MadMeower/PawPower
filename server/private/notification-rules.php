<?php
declare(strict_types=1);
// Pure rule evaluation; no network, secrets or device-control operations.
function paw_alert_definitions(): array {
    return [
        'low_voltage' => ['battery_voltage', 'below', 'Low battery voltage'],
        'low_soc' => ['battery_soc', 'below', 'Low battery charge'],
        'low_temp' => ['battery_temperature_c', 'below', 'Low battery temperature'],
        'high_temp' => ['battery_temperature_c', 'above', 'High battery temperature'],
        'danger_temp' => ['battery_temperature_c', 'above', 'Danger: battery temperature'],
        'charging' => ['battery_current', 'above', 'Battery charging'],
        'full' => ['battery_soc', 'above', 'Battery fully charged'],
        'custom_1' => [null, null, 'Custom battery alert 1'],
        'custom_2' => [null, null, 'Custom battery alert 2'],
        'custom_3' => [null, null, 'Custom battery alert 3'],
    ];
}
function paw_alert_metrics(): array {
    // [minimum, maximum, recovery margin, unit]
    return ['battery_voltage' => [0, 1000, 0.3, 'V'],
        'battery_soc' => [0, 100, 2, '%'],
        'battery_temperature_c' => [-100, 150, 2, '°C'],
        'battery_current' => [-2000, 2000, 0.3, 'A']];
}
function paw_alert_number(mixed $v): bool {
    return (is_int($v) || is_float($v)) && is_finite((float) $v);
}
function paw_alert_name(mixed $name): string {
    if (!is_string($name) || !preg_match('//u', $name) ||
        preg_match('/[\x00-\x1f\x7f]/', $name)) throw new InvalidArgumentException('Invalid alert name');
    $name = trim($name);
    if (strlen($name) > 64 || preg_match_all('/./us', $name) > 32)
        throw new InvalidArgumentException('Alert name too long');
    return $name;
}
function paw_alert_validate(array $prefs): array {
    if (($prefs['version'] ?? null) !== 1 || !is_int($prefs['delay'] ?? null) ||
        $prefs['delay'] < 30 || $prefs['delay'] > 600 ||
        !is_array($prefs['rules'] ?? null) || !array_is_list($prefs['rules']) ||
        count($prefs['rules']) !== 10) throw new InvalidArgumentException('Invalid alert preferences');
    $definitions = paw_alert_definitions(); $metrics = paw_alert_metrics(); $seen = [];
    foreach ($prefs['rules'] as $rule) {
        if (!is_array($rule) || !is_string($rule['id'] ?? null) ||
            !isset($definitions[$rule['id']]) || isset($seen[$rule['id']]) ||
            !is_bool($rule['enabled'] ?? null) ||
            !is_string($rule['metric'] ?? null) || !isset($metrics[$rule['metric']]) ||
            !in_array($rule['direction'] ?? null, ['above', 'below'], true) ||
            !paw_alert_number($rule['threshold'] ?? null)) throw new InvalidArgumentException('Invalid rule');
        $id = $rule['id']; $seen[$id] = $rule;
        [$metric, $direction] = $definitions[$id];
        if ($metric !== null && ($rule['metric'] !== $metric || $rule['direction'] !== $direction))
            throw new InvalidArgumentException('Invalid fixed rule');
        [$min, $max] = $metrics[$rule['metric']];
        if ($rule['threshold'] < $min || $rule['threshold'] > $max)
            throw new InvalidArgumentException('Threshold out of range');
        $seen[$id] = ['id'=>$id, 'metric'=>$rule['metric'], 'direction'=>$rule['direction'],
            'threshold'=>$rule['threshold'], 'enabled'=>$rule['enabled']];
        if ($metric === null && array_key_exists('name', $rule)) $seen[$id]['name'] = paw_alert_name($rule['name']);
    }
    if ($seen['low_temp']['threshold'] >= $seen['high_temp']['threshold'] ||
        $seen['high_temp']['threshold'] >= $seen['danger_temp']['threshold'] ||
        $seen['low_soc']['threshold'] >= $seen['full']['threshold'])
        throw new InvalidArgumentException('Thresholds must be ordered');
    // Canonical order makes reordering JSON harmless to saved event state.
    $prefs['rules'] = array_values(array_intersect_key(array_replace($definitions, $seen), $definitions));
    return ['version' => 1, 'delay' => $prefs['delay'], 'rules' => $prefs['rules']];
}

function paw_alert_expand_device(array $body): array {
    if (!is_string($body['r'] ?? null) || !is_bool($body['e'] ?? null) ||
        !is_int($body['d'] ?? null) || !is_array($body['l'] ?? null) ||
        !array_is_list($body['l']) || count($body['l']) !== 10)
        throw new InvalidArgumentException('Invalid device settings');
    $rules = []; $metrics = array_keys(paw_alert_metrics()); $index = 0;
    foreach (paw_alert_definitions() as $id => [$metric, $direction, $_]) {
        $item = $body['l'][$index++];
        $custom = $metric === null;
        if (!is_array($item) || !array_is_list($item) || !in_array(count($item), $custom ? [4,5] : [2], true) ||
            !in_array($item[0], [0,1], true)) throw new InvalidArgumentException('Invalid device rule');
        if ($custom) {
            if (!is_int($item[1]) || !isset($metrics[$item[1]]) ||
                !in_array($item[2], [0,1], true)) throw new InvalidArgumentException('Invalid custom rule');
            $metric = $metrics[$item[1]]; $direction = $item[2] === 1 ? 'above' : 'below';
        }
        $rules[] = ['id'=>$id,'metric'=>$metric,'direction'=>$direction,
            'enabled'=>$item[0]===1,'threshold'=>$item[$custom ? 3 : 1]];
        if ($custom && count($item) === 5) $rules[array_key_last($rules)]['name'] = paw_alert_name($item[4]);
    }
    return ['revision'=>$body['r'],'enabled'=>$body['e'],
        'preferences'=>['version'=>1,'delay'=>$body['d'],'rules'=>$rules]];
}

// Called once per fresh device snapshot. State is persisted by the endpoint under a lock.
// A condition must remain confirmed through the delay; >90s gaps break confirmation.
// A successful episode stays latched until recovery beyond the metric's margin.
function paw_alert_evaluate(array $prefs, bool $enabled, array $values, array $state, int $now): array {
    $events = []; $next = []; $metrics = paw_alert_metrics(); $definitions = paw_alert_definitions();
    foreach ($prefs['rules'] as $rule) {
        $id = $rule['id']; $metric = $rule['metric'];
        $condition = $rule; unset($condition['name']);
        $fingerprint = hash('sha256', json_encode([$prefs['delay'], $condition], JSON_THROW_ON_ERROR));
        $old = $state[$id] ?? [];
        if (($old['fingerprint'] ?? '') !== $fingerprint) $old = ['attempted' => $old['attempted'] ?? 0];
        $s = ['fingerprint' => $fingerprint, 'since' => $old['since'] ?? null,
            'last' => $now, 'latched' => $old['latched'] ?? false,
            'attempted' => $old['attempted'] ?? 0];
        $value = $values[$metric] ?? null; [$min, $max, $margin, $unit] = $metrics[$metric];
        if (!$enabled || !$rule['enabled']) {
            $s['since'] = null; $s['latched'] = false;
        } elseif (!paw_alert_number($value) || $value < $min || $value > $max) {
            $s['since'] = null; // Keep the latch: loss of telemetry is not recovery.
        } else {
            $above = $rule['direction'] === 'above'; $threshold = $rule['threshold'];
            $hit = $above ? $value >= $threshold : $value <= $threshold;
            $recovered = $above ? $value < $threshold - $margin : $value > $threshold + $margin;
            if ($recovered) { $s['latched'] = false; $s['since'] = null; }
            if (!$hit) { $s['since'] = null; }
            elseif (!$s['latched']) {
                if ($s['since'] === null || $now - ($old['last'] ?? 0) > 90 || $now < ($old['last'] ?? 0))
                    $s['since'] = $now;
                if ($now - $s['since'] >= $prefs['delay'] && $now - $s['attempted'] >= 300) {
                    $displayValue = $metric === 'battery_temperature_c' ? $value * 1.8 + 32 : $value;
                    $displayThreshold = $metric === 'battery_temperature_c' ? round($threshold * 1.8 + 32, 2) : $threshold;
                    $displayUnit = $metric === 'battery_temperature_c' ? '°F' : $unit;
                    $events[] = ['id' => $id, 'title' => str_starts_with($id, 'custom_') && ($rule['name'] ?? '') !== '' ? $rule['name'] : $definitions[$id][2],
                        'message' => sprintf('Battery: %s %s (%s %s %s).',
                            round((float) $displayValue, 2), $displayUnit,
                            $above ? 'at or above' : 'at or below', $displayThreshold, $displayUnit)];
                    $s['attempted'] = $now;
                }
            }
        }
        $next[$id] = $s;
    }
    return ['state' => $next, 'events' => $events];
}
