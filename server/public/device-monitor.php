<?php
declare(strict_types=1);
if (!defined('PAW_PRIVATE')) define('PAW_PRIVATE', (getenv('PAWPOWER_PRIVATE_DIR') ?: dirname(__DIR__).'/pawpower-private'));
ini_set('display_errors', '0');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
try {
    require PAW_PRIVATE . '/backend.php';
    require PAW_PRIVATE . '/notification-rules.php';
    require PAW_PRIVATE . '/notification-settings.php';
    require PAW_PRIVATE . '/equipment-alerts.php';
    if (($_SERVER['HTTPS'] ?? '') !== 'on' && ($_SERVER['SERVER_PORT'] ?? '') !== '443')
        paw_json(['error' => 'HTTPS required'], 400);
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST'); paw_json(['error' => 'POST required'], 405);
    }
    $config = paw_config();
    $device = $_GET['device'] ?? 'pawpower';
    if (!is_string($device) || !in_array($device, ['pawpower','tracer'], true)) paw_json(['error'=>'Unauthorized'],401);
    paw_auth($config['device_tokens'][$device]);
    $raw = file_get_contents('php://input', false, null, 0, 8193);
    if ($raw === false || strlen($raw) > 8192) paw_json(['error' => 'Request too large'], 413);
    try {
        $body = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($body) || !is_array($body['readings'] ?? null))
            throw new InvalidArgumentException();
        $equipment = paw_equipment_values($device, $body['equipment'] ?? null);
        foreach (paw_alert_metrics() as $metric => $_) {
            $v = $body['readings'][$metric] ?? null;
            if ($v !== null && !paw_alert_number($v)) throw new InvalidArgumentException();
        }
    } catch (JsonException | InvalidArgumentException $error) {
        paw_json(['error' => 'Invalid notification rules or readings'], 400);
    }
    $result = paw_lock(function () use ($config, $body, $device, $equipment): array {
        $path = PAW_PRIVATE . ($device === 'pawpower' ? '/notification-state.json' : '/notification-state-tracer.json');
        $saved = paw_read($path);
        $now = time();
        if (($saved['received_at'] ?? 0) > $now - 10)
            return ['ok' => true, 'reason' => 'rate_limited'];
        $settings = paw_notification_settings();
        $evaluation = $device === 'pawpower' ? paw_alert_evaluate($settings['preferences'], $settings['enabled'], $body['readings'],
            $saved['rules'] ?? [], $now) : ['state'=>[], 'events'=>[]];
        $equipmentSettings = paw_equipment_settings();
        $extra = paw_equipment_evaluate($device, $equipment, $equipmentSettings, $settings['enabled'], $saved['rules'] ?? [], $now);
        $evaluation['events'] = array_merge($evaluation['events'], $extra['events']);
        $state = array_merge($evaluation['state'], $extra['state']);
        paw_write(PAW_PRIVATE . '/equipment-' . $device . '-latest.json', ['received_at'=>$now, 'values'=>$equipment,
            'active'=>paw_equipment_active($device, $equipment, $equipmentSettings)]);
        usort($evaluation['events'], static fn(array $a, array $b): int =>
            ($a['id'] === 'danger_temp' ? 0 : 1) <=> ($b['id'] === 'danger_temp' ? 0 : 1));
        $events = array_slice($evaluation['events'], 0, 3);
        // Unsent overflow is eligible on the next sample, rather than being discarded.
        foreach (array_slice($evaluation['events'], 3) as $event)
            $state[$event['id']]['attempted'] = $saved['rules'][$event['id']]['attempted'] ?? 0;
        paw_write($path, ['received_at' => $now, 'rules' => $state]);
        $sent = 0; $failed = 0; $reason = '';
        foreach ($events as $event) {
            $push = paw_push($config, $event['title'], $event['message'], $device, $event['id']);
            $sent += $push['sent']; $failed += $push['failed'];
            $reason = $push['reason'] ?? $reason;
            // If at least one phone accepted it, latch the episode to avoid repeats.
            // Failed deliveries retry only while the condition remains, no faster than 5 minutes.
            if ($push['sent'] > 0) $state[$event['id']]['latched'] = true;
            paw_write($path, ['received_at' => $now, 'rules' => $state]);
        }
        return ['ok' => true, 'sent' => $sent, 'failed' => $failed, 'reason' => $reason];
    });
    paw_json($result);
} catch (Throwable $error) {
    error_log('PawPower notification rules: ' . get_class($error));
    http_response_code(503); header('Content-Type: application/json');
    echo '{"error":"Notification service unavailable"}';
}
