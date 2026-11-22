<?php
declare(strict_types=1);
if(!defined('PAW_PRIVATE'))define('PAW_PRIVATE',(getenv('PAWPOWER_PRIVATE_DIR') ?: dirname(__DIR__).'/pawpower-private'));
ini_set('display_errors','0');header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
try{
    require PAW_PRIVATE.'/backend.php';
    require PAW_PRIVATE.'/device-logs.php';
    if(($_SERVER['HTTPS']??'')!=='on'&&($_SERVER['SERVER_PORT']??'')!=='443')paw_json(['error'=>'HTTPS required'],400);
    $config=paw_config();paw_auth($config['app_token']);
    if(($_SERVER['REQUEST_METHOD']??'')!=='GET')paw_json(['error'=>'Method not allowed'],405);
    $device=$_GET['device']??'';$date=$_GET['date']??'';
    if(!is_string($device)||!in_array($device,['pawpower','tracer'],true)||!is_string($date)||!paw_log_valid_date($date)||
       $date<paw_log_oldest(time())||$date>paw_log_date(time()))paw_json(['error'=>'Invalid unit or retained day'],400);
    paw_json(paw_lock(fn()=>paw_log_view($device,$date,time())));
}catch(Throwable $e){error_log('PawPower unit logs: '.get_class($e));http_response_code(503);header('Content-Type: application/json');echo '{"error":"Unit logs unavailable"}';}
