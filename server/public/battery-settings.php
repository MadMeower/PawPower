<?php
declare(strict_types=1);
if (!defined('PAW_PRIVATE')) define('PAW_PRIVATE',(getenv('PAWPOWER_PRIVATE_DIR') ?: dirname(__DIR__).'/pawpower-private'));
ini_set('display_errors','0');
header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
try {
    require PAW_PRIVATE.'/backend.php';
    require PAW_PRIVATE.'/battery-settings.php';
    if (($_SERVER['HTTPS']??'')!=='on' && ($_SERVER['SERVER_PORT']??'')!=='443') paw_json(['error'=>'HTTPS required'],400);
    $method=$_SERVER['REQUEST_METHOD']??'';
    $device=isset($_GET['device']);
    if ($device && $_GET['device']!=='pawpower') paw_json(['error'=>'Unauthorized'],401);
    if (!in_array($method,['GET','POST'],true) || ($device && $method!=='POST')) paw_json(['error'=>'Method not allowed'],405);
    $config=paw_config();paw_auth($device?$config['device_tokens']['pawpower']:$config['app_token']);
    $body=null;
    if ($method==='POST') {
        $raw=file_get_contents('php://input',false,null,0,4097);
        if ($raw===false || strlen($raw)>4096) paw_json(['error'=>'Request too large'],413);
        $body=json_decode($raw,true,16,JSON_THROW_ON_ERROR);
        if (!is_array($body)) throw new InvalidArgumentException();
    }
    $response=paw_lock(function()use($body,$device):array{
        $path=PAW_PRIVATE.'/battery-control-state.json';
        [$code,$saved,$view]=paw_battery_step(paw_read($path),$body,$device,time());
        paw_write($path,$saved);
        return [$code,$view];
    });
    paw_json($response[1],$response[0]);
} catch (JsonException|InvalidArgumentException $e) {paw_json(['error'=>'Invalid battery settings; check ranges and stop/resume order'],400);}
catch(Throwable $e){error_log('PawPower battery settings: '.get_class($e));http_response_code(503);header('Content-Type: application/json');echo '{"error":"Battery settings unavailable"}';}
