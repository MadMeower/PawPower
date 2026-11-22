<?php
declare(strict_types=1);
if (!defined('PAW_PRIVATE')) define('PAW_PRIVATE', (getenv('PAWPOWER_PRIVATE_DIR') ?: dirname(__DIR__).'/pawpower-private'));
ini_set('display_errors', '0');
header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff');
try {
    require PAW_PRIVATE . '/backend.php';
    require PAW_PRIVATE . '/notification-rules.php';
    require PAW_PRIVATE . '/notification-settings.php';
    if (($_SERVER['HTTPS'] ?? '') !== 'on' && ($_SERVER['SERVER_PORT'] ?? '') !== '443')
        paw_json(['error' => 'HTTPS required'], 400);
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if (!in_array($method, ['GET', 'POST'], true)) {
        header('Allow: GET, POST'); paw_json(['error' => 'Method not allowed'], 405);
    }
    $config = paw_config();
    $device = $_GET['device'] ?? null;
    if ($device !== null && $device !== 'pawpower') paw_json(['error' => 'Unauthorized'], 401);
    paw_auth($device === 'pawpower' ? $config['device_tokens']['pawpower'] : $config['app_token']);
    $update = null;
    if ($method === 'POST') {
        $raw = file_get_contents('php://input', false, null, 0, 4097);
        if ($raw === false || strlen($raw) > 4096) paw_json(['error' => 'Request too large'], 413);
        try {
            $update = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
            if ($device === 'pawpower' && is_array($update) && isset($update['l']))
                $update = paw_alert_expand_device($update);
            if (!is_array($update) || !is_bool($update['enabled'] ?? null) ||
                !is_string($update['revision'] ?? null) || strlen($update['revision']) !== 32 ||
                !is_array($update['preferences'] ?? null)) throw new InvalidArgumentException();
            $update['preferences'] = paw_alert_validate($update['preferences']);
        } catch (JsonException | InvalidArgumentException $error) {
            paw_json(['error' => 'Invalid rules. Check threshold ranges and temperature order.'], 400);
        }
    }
    $result = paw_lock(function () use ($update): array {
        $saved = paw_notification_settings();
        if ($update !== null) {
            if (!hash_equals($saved['revision'], $update['revision']))
                return ['code' => 409, 'body' => ['error' => 'Preferences changed elsewhere. Reload before saving.']];
            // Older clients omit names. Preserve them rather than silently erasing them.
            foreach ($update['preferences']['rules'] as &$rule) {
                if (!str_starts_with($rule['id'], 'custom_') || array_key_exists('name', $rule)) continue;
                foreach ($saved['preferences']['rules'] as $previous) {
                    if ($previous['id'] === $rule['id'] && isset($previous['name'])) $rule['name'] = $previous['name'];
                }
            }
            unset($rule);
            $saved = ['revision' => bin2hex(random_bytes(16)), 'enabled' => $update['enabled'],
                'preferences' => $update['preferences']];
            paw_write(PAW_PRIVATE . '/notification-preferences.json', $saved);
        }
        return ['code' => 200, 'body' => $saved];
    });
    paw_json($result['body'], $result['code']);
} catch (Throwable $error) {
    error_log('PawPower preferences: ' . get_class($error));
    http_response_code(503); header('Content-Type: application/json');
    echo '{"error":"Notification preferences unavailable"}';
}
