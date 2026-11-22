<?php
declare(strict_types=1);
if(!defined('PAW_PRIVATE'))define('PAW_PRIVATE',getenv('PAWPOWER_PRIVATE_DIR')?:dirname(__DIR__).'/pawpower-private');
ini_set('display_errors','0');
header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
try{
    require PAW_PRIVATE.'/backend.php';
    require PAW_PRIVATE.'/widget-push.php';
    if(($_SERVER['HTTPS']??'')!=='on'&&($_SERVER['SERVER_PORT']??'')!=='443')paw_json(['error'=>'HTTPS required'],400);
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'){header('Allow: POST');paw_json(['error'=>'POST required'],405);}
    $config=paw_config();paw_auth($config['app_token']);$body=paw_body();
    $result=paw_lock(static fn()=>paw_widget_subscribe($body,time()));
    paw_json($result['body'],$result['code']);
}catch(Throwable $error){
    error_log('PawPower widget subscription: '.get_class($error));
    http_response_code(503);header('Content-Type: application/json');echo '{"error":"Widget subscription unavailable"}';
}
