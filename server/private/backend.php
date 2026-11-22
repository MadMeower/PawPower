<?php
declare(strict_types=1);
// PawPower server prototype 0.1. Keep this entire directory outside all document roots.
function paw_json(array $value, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    exit;
}
function paw_read(string $path, array $fallback = []): array {
    if (!is_file($path)) return $fallback;
    $value = json_decode((string)file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($value)) throw new RuntimeException('Invalid stored data');
    return $value;
}
function paw_write(string $path, array $value): void {
    $tmp = tempnam(dirname($path), '.paw-');
    if ($tmp === false) throw new RuntimeException('Storage unavailable');
    try {
        chmod($tmp, 0600);
        $bytes = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        if (file_put_contents($tmp, $bytes) !== strlen($bytes) || !rename($tmp, $path)) {
            throw new RuntimeException('Storage write failed');
        }
    } finally { if (is_file($tmp)) unlink($tmp); }
}
function paw_lock(callable $fn): mixed {
    $h = fopen(PAW_PRIVATE . '/state.lock', 'c');
    if ($h === false || !flock($h, LOCK_EX)) throw new RuntimeException('Storage locked');
    chmod(PAW_PRIVATE . '/state.lock', 0600);
    try { return $fn(); } finally { flock($h, LOCK_UN); fclose($h); }
}
function paw_config(): array {
    $path = PAW_PRIVATE . '/config.php';
    if (!is_file($path)) {
        paw_lock(function () use ($path): void {
            if (is_file($path)) return;
            $config = [
                'version' => 1,
                'app_token' => bin2hex(random_bytes(32)),
                'admin_token' => bin2hex(random_bytes(32)),
                'device_tokens' => [
                    'pawpower' => bin2hex(random_bytes(32)),
                    'tracer' => bin2hex(random_bytes(32)),
                ],
                'push_enabled' => false,
                'alert_cooldown_seconds' => 900,
            ];
            $text = "<?php\n// Private. Never publish or commit this file.\nreturn " . var_export($config, true) . ";\n";
            $h = fopen($path, 'x');
            if ($h === false) throw new RuntimeException('Cannot create private configuration');
            chmod($path, 0600);
            try { if (fwrite($h, $text) !== strlen($text)) throw new RuntimeException('Configuration write failed'); }
            finally { fclose($h); }
        });
    }
    $config = require $path;
    if (!is_array($config)) throw new RuntimeException('Invalid configuration');
    return $config;
}
function paw_auth(string $expected): void {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer ([A-Za-z0-9_-]{32,256})$/D', $header, $m) ||
        strlen($expected) < 32 || !hash_equals($expected, $m[1])) paw_json(['error' => 'Unauthorized'], 401);
}
function paw_body(): array {
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') {
        paw_json(['error' => 'Use application/json'], 415);
    }
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) paw_json(['error' => 'Body too large'], 413);
    $raw = file_get_contents('php://input', false, null, 0, 8193);
    if ($raw === false || strlen($raw) > 8192) paw_json(['error' => 'Body too large'], 413);
    try { $body = json_decode($raw, true, 16, JSON_THROW_ON_ERROR); }
    catch (JsonException) { paw_json(['error' => 'Invalid JSON'], 400); }
    if (!is_array($body) || array_is_list($body)) paw_json(['error' => 'JSON object required'], 400);
    return $body;
}
function paw_http(string $url, array $headers, string $body): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 12,
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS]);
    $reply = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($reply === false) throw new RuntimeException('Outbound HTTPS failed');
    $data = json_decode($reply, true);
    return [$status, is_array($data) ? $data : []];
}
function paw_service_account(): array {
    $sa = paw_read(PAW_PRIVATE . '/firebase-service-account.json');
    if (($sa['type'] ?? '') !== 'service_account' ||
        !preg_match('/^[a-z][a-z0-9-]{4,62}$/D', $sa['project_id'] ?? '') ||
        !filter_var($sa['client_email'] ?? '', FILTER_VALIDATE_EMAIL) || empty($sa['private_key'])) {
        throw new RuntimeException('Invalid Firebase service account');
    }
    return $sa;
}
function paw_b64(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }
function paw_oauth(array $sa): string {
    $cache = paw_read(PAW_PRIVATE . '/oauth-cache.json');
    if (($cache['expires_at'] ?? 0) > time() + 60 && ($cache['project_id'] ?? '') === $sa['project_id']) {
        return (string)$cache['access_token'];
    }
    $now = time();
    $jwt = paw_b64(json_encode(['alg'=>'RS256','typ'=>'JWT'], JSON_THROW_ON_ERROR)) . '.' .
        paw_b64(json_encode(['iss'=>$sa['client_email'],
            'scope'=>'https://www.googleapis.com/auth/firebase.messaging',
            'aud'=>'https://oauth2.googleapis.com/token', 'iat'=>$now,'exp'=>$now+3600], JSON_THROW_ON_ERROR));
    if (!openssl_sign($jwt, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256)) throw new RuntimeException('Firebase signing failed');
    [$status, $reply] = paw_http('https://oauth2.googleapis.com/token',
        ['Content-Type: application/x-www-form-urlencoded'], http_build_query([
            'grant_type'=>'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion'=>$jwt.'.'.paw_b64($sig)]));
    if ($status !== 200 || empty($reply['access_token'])) throw new RuntimeException('Firebase authentication rejected');
    paw_write(PAW_PRIVATE . '/oauth-cache.json', ['project_id'=>$sa['project_id'],
        'access_token'=>$reply['access_token'],'expires_at'=>$now+(int)($reply['expires_in'] ?? 3600)]);
    return $reply['access_token'];
}
function paw_push(array $config, string $title, string $message, string $device, string $kind): array {
    if (!$config['push_enabled']) return ['sent'=>0,'failed'=>0,'reason'=>'push_disabled'];
    $phones = paw_read(PAW_PRIVATE . '/phones.json');
    if (!$phones) return ['sent'=>0,'failed'=>0,'reason'=>'no_registered_phone'];
    $sa = paw_service_account();
    $access = paw_oauth($sa);
    $sent = 0; $failed = 0;
    foreach ($phones as $id => $phone) {
        [$status, $reply] = paw_http('https://fcm.googleapis.com/v1/projects/' . $sa['project_id'] . '/messages:send',
            ['Authorization: Bearer '.$access,'Content-Type: application/json'],
            json_encode(['message'=>['token'=>$phone['token'],
                'notification'=>['title'=>$title,'body'=>$message],
                'data'=>['device'=>$device,'kind'=>$kind],
                'android'=>['priority'=>'HIGH','ttl'=>'300s',
                    'notification'=>['channel_id'=>'pawpower_alerts','sound'=>'default']]]], JSON_THROW_ON_ERROR));
        if ($status === 200) ++$sent; else ++$failed;
        foreach (($reply['error']['details'] ?? []) as $detail) {
            if (($detail['errorCode'] ?? '') === 'UNREGISTERED') unset($phones[$id]);
        }
    }
    paw_write(PAW_PRIVATE . '/phones.json', $phones);
    return ['sent'=>$sent,'failed'=>$failed];
}
function paw_readings(array $input): array {
    $bounds = ['battery_voltage'=>[0,1000], 'battery_current'=>[-2000,2000],
        'battery_soc'=>[0,100], 'battery_temperature_c'=>[-100,150],
        'controller_temperature_c'=>[-100,150], 'solar_watts'=>[0,100000],
        'solar_voltage'=>[0,1500], 'solar_current'=>[0,2000],
        'charge_kwh_today'=>[0,10000], 'discharge_kwh_today'=>[0,10000],
        'solar_kwh_today'=>[0,10000]];
    if (!$input || array_is_list($input)) paw_json(['error'=>'Readings object required'],400);
    $out = [];
    foreach ($input as $name=>$value) {
        if (!isset($bounds[$name])) paw_json(['error'=>'Unknown reading field'],400);
        if ($value === null) { $out[$name] = null; continue; }
        if ((!is_int($value) && !is_float($value)) || !is_finite((float)$value) ||
            $value < $bounds[$name][0] || $value > $bounds[$name][1]) paw_json(['error'=>'Invalid reading value'],400);
        $out[$name] = $value;
    }
    return $out;
}
