<?php
declare(strict_types=1);
if(!defined('PAW_PRIVATE'))define('PAW_PRIVATE',(getenv('PAWPOWER_PRIVATE_DIR') ?: dirname(__DIR__).'/pawpower-private'));
ini_set('display_errors','0');header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
try {
    require PAW_PRIVATE.'/backend.php';
    require PAW_PRIVATE.'/notification-rules.php';
    require PAW_PRIVATE.'/notification-settings.php';
    require PAW_PRIVATE.'/equipment-alerts.php';
    if(($_SERVER['HTTPS']??'')!=='on'&&($_SERVER['SERVER_PORT']??'')!=='443')paw_json(['error'=>'HTTPS required'],400);
    $device=$_GET['device']??null;
    if($device!==null&&(!is_string($device)||!in_array($device,['pawpower','tracer'],true)))paw_json(['error'=>'Unauthorized'],401);
    $config=paw_config();paw_auth($device===null?$config['app_token']:$config['device_tokens'][$device]);
    $method=$_SERVER['REQUEST_METHOD']??'';
    if(!in_array($method,['GET','POST'],true))paw_json(['error'=>'Method not allowed'],405);
    $body=null;
    if($method==='POST'){
        $raw=file_get_contents('php://input',false,null,0,4097);
        if($raw===false||strlen($raw)>4096)paw_json(['error'=>'Request too large'],413);
        $body=json_decode($raw,true,16,JSON_THROW_ON_ERROR);
        if(!is_array($body))throw new InvalidArgumentException();
    }
    $reply=paw_lock(function()use($body,$device):array {
        $s=paw_equipment_settings();$master=paw_notification_settings();
        if($body!==null) {
            $next=$device===null?paw_equipment_validate($body):paw_equipment_device_patch($device,$body,$s);
            if(!hash_equals($s['revision'],$next['revision']))return [409,['error'=>'Settings changed; reload first']];
            if($device==='tracer') {
                if(!hash_equals($master['revision'],$body['m']))return [409,['error'=>'Notifications changed; reload first']];
                if($master['enabled']!==$body['n']) {
                    $master['enabled']=$body['n'];$master['revision']=bin2hex(random_bytes(16));
                    paw_write(PAW_PRIVATE.'/notification-preferences.json',$master);
                }
            }
            $s=$next;$s['revision']=bin2hex(random_bytes(16));paw_write(PAW_PRIVATE.'/equipment-preferences.json',$s);
        }
        return [200,paw_equipment_view($s,$device,$master)];
    });
    paw_json($reply[1],$reply[0]);
}catch(JsonException|InvalidArgumentException|TypeError $e){paw_json(['error'=>'Invalid equipment preferences'],400);}
catch(Throwable $e){error_log('PawPower equipment preferences: '.get_class($e));http_response_code(503);header('Content-Type: application/json');echo '{"error":"Equipment preferences unavailable"}';}
