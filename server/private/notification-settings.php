<?php
declare(strict_types=1);
function paw_notification_settings(): array {
    $path = PAW_PRIVATE . '/notification-preferences.json';
    $saved = paw_read($path);
    if ($saved) return $saved;
    $saved = ['revision' => bin2hex(random_bytes(16)), 'enabled' => false,
        'preferences' => json_decode('{"version":1,"delay":60,"rules":[{"id":"low_voltage","metric":"battery_voltage","direction":"below","threshold":12,"enabled":false},{"id":"low_soc","metric":"battery_soc","direction":"below","threshold":20,"enabled":false},{"id":"low_temp","metric":"battery_temperature_c","direction":"below","threshold":0,"enabled":false},{"id":"high_temp","metric":"battery_temperature_c","direction":"above","threshold":45,"enabled":false},{"id":"danger_temp","metric":"battery_temperature_c","direction":"above","threshold":55,"enabled":false},{"id":"charging","metric":"battery_current","direction":"above","threshold":0.5,"enabled":false},{"id":"full","metric":"battery_soc","direction":"above","threshold":99,"enabled":false},{"id":"custom_1","metric":"battery_soc","direction":"below","threshold":15,"enabled":false},{"id":"custom_2","metric":"battery_soc","direction":"below","threshold":10,"enabled":false},{"id":"custom_3","metric":"battery_temperature_c","direction":"above","threshold":50,"enabled":false}]}', true, 32, JSON_THROW_ON_ERROR)];
    paw_write($path, $saved);
    return $saved;
}
