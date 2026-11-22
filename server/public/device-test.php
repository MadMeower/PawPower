<?php
declare(strict_types=1);
// Companion to api.php. Keep backend.php and config.php in the existing private directory.
if (!defined('PAW_PRIVATE')) define('PAW_PRIVATE', (getenv('PAWPOWER_PRIVATE_DIR') ?: dirname(__DIR__).'/pawpower-private'));
ini_set('display_errors', '0');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
try {
    require PAW_PRIVATE . '/backend.php';
    if (($_SERVER['HTTPS'] ?? '') !== 'on' && ($_SERVER['SERVER_PORT'] ?? '') !== '443') {
        paw_json(['error' => 'HTTPS required'], 400);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST');
        paw_json(['error' => 'POST required'], 405);
    }
    $config = paw_config();
    $id = $_GET['device'] ?? '';
    if (!is_string($id) || !in_array($id, ['pawpower', 'tracer'], true) ||
        !isset($config['device_tokens'][$id])) {
        paw_json(['error' => 'Unauthorized'], 401);
    }
    paw_auth($config['device_tokens'][$id]);
    // No caller-provided title, message, recipient or alert kind is used.
    $result = paw_lock(function () use ($config, $id): array {
        if (!$config['push_enabled']) return ['sent' => 0, 'failed' => 0, 'reason' => 'push_disabled'];
        $path = PAW_PRIVATE . '/web-test-push.json';
        $last = paw_read($path);
        // One global cooldown across the webpages; records an attempt before sending.
        if (($last['attempted_at'] ?? 0) > time() - 60) {
            return ['sent' => 0, 'failed' => 0, 'reason' => 'cooldown'];
        }
        paw_write($path, ['attempted_at' => time()]);
        return paw_push($config, 'PawPower test',
            'Test notification from the ' . ($id === 'tracer' ? 'Tracer' : 'battery') . ' webpage.',
            $id, 'test');
    });
    paw_json($result);
} catch (Throwable $error) {
    error_log('PawPower device test: ' . get_class($error));
    http_response_code(503);
    header('Content-Type: application/json');
    echo '{"error":"Server setup or upstream service unavailable"}';
}
