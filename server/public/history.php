<?php
declare(strict_types=1);
if(!defined('PAW_PRIVATE'))define('PAW_PRIVATE',(getenv('PAWPOWER_PRIVATE_DIR') ?: dirname(__DIR__).'/pawpower-private'));
ini_set('display_errors','0');
header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
try {
    require PAW_PRIVATE.'/backend.php';
    require PAW_PRIVATE.'/history.php';
    if(($_SERVER['HTTPS']??'')!=='on' && ($_SERVER['SERVER_PORT']??'')!=='443')
        paw_json(['error'=>'HTTPS required'],400);
    $config=paw_config();$method=$_SERVER['REQUEST_METHOD']??'';
    if($method==='POST') {
        $device=$_GET['device']??'';
        if(!is_string($device)||!in_array($device,['pawpower','tracer'],true))paw_json(['error'=>'Unauthorized'],401);
        paw_auth($config['device_tokens'][$device]);
        if(is_file(PAW_PRIVATE.'/device-logs.php')){require_once PAW_PRIVATE.'/device-logs.php';}
        $logSupport=function_exists('paw_log_validate');
        $raw=file_get_contents('php://input',false,null,0,12289);
        if($raw===false||strlen($raw)>12288)paw_json(['error'=>'Request too large'],413);
        try {
            $body=json_decode($raw,true,16,JSON_THROW_ON_ERROR);
            if(!is_array($body)||!is_array($body['readings']??null))throw new InvalidArgumentException();
            $values=paw_history_values($body['readings']);
            $ledgers=paw_history_ledgers($body['days']??[],time());
            $logs=null;
            if(isset($body['logs'])&&$logSupport)$logs=paw_log_validate($body['logs'],$device,time());
        }catch(JsonException|InvalidArgumentException $e){paw_json(['error'=>'Invalid history snapshot'],400);}
        $result=paw_lock(function()use($device,$values,$ledgers,$logs,$logSupport):array {
            $now=time();$metaPath=PAW_PRIVATE.'/history-'.$device.'-latest.json';
            $previous=paw_read($metaPath);
            if(isset($previous['time']) && $now-$previous['time']<10)
                return ['ok'=>true,'reason'=>'rate_limited','logs_supported'=>$logSupport];
            if($logs!==null)paw_log_record($device,$logs,$now);
            $dates=[paw_history_date($now)];
            if(isset($previous['time']) && $now-$previous['time']<=90 &&
                paw_history_date($previous['time'])!==$dates[0])$dates[]=paw_history_date($previous['time']);
            foreach($dates as$date) {
                $path=PAW_PRIVATE.'/history-'.$device.'-'.$date.'.json';
                $day=paw_read($path,paw_history_day($date));
                // On the previous date only integrate the midnight slice, not today's totals or peaks.
                if($date!==$dates[0]) {
                    $before=$day;$day=paw_history_record($day,$values,$previous,$now);
                    foreach(['observed_seconds','solar_observed_seconds','charge_observed_kwh',
                        'discharge_observed_kwh','solar_observed_kwh']as$key)$before[$key]=$day[$key];
                    $day=$before;
                }else $day=paw_history_record($day,$values,$previous?:null,$now);
                paw_write($path,$day);
            }
            foreach($ledgers as$ledger) {
                $path=PAW_PRIVATE.'/history-'.$device.'-'.$ledger['date'].'.json';
                $day=paw_read($path,paw_history_day($ledger['date']));
                paw_write($path,paw_history_merge_ledger($day,$ledger,$device));
            }
            paw_write($metaPath,['time'=>$now,'values'=>$values]);
            // Keep 31 local calendar days, without accepting filenames from a caller.
            foreach(glob(PAW_PRIVATE.'/history-'.$device.'-????-??-??.json')?:[] as$file) {
                $date=substr(basename($file),-15,10);
                if($date<paw_history_oldest($now))unlink($file);
            }
            return ['ok'=>true,'logs_supported'=>$logSupport]+($logs!==null?['logs'=>true]:[]);
        });
        paw_json($result);
    }
    if($method!=='GET'){header('Allow: GET, POST');paw_json(['error'=>'Method not allowed'],405);}
    paw_auth($config['app_token']);
    // Authentication above is required before returning any live battery metadata.
    if (($_GET['latest'] ?? '') === '1') {
        $result = paw_lock(function(): array {
            $latest = paw_read(PAW_PRIVATE.'/history-pawpower-latest.json');
            $values = $latest['values'] ?? [];
            $readings = [];
            foreach (['battery_current','battery_capacity_ah','battery_remaining_ah','shunt_remaining_minutes'] as $key)
                $readings[$key] = $values[$key] ?? null;
            $equipment = [];
            foreach (['pawpower','tracer'] as $id) {
                $row = paw_read(PAW_PRIVATE.'/equipment-'.$id.'-latest.json');
                if ($row) $equipment[$id] = ['age_seconds'=>max(0,time()-$row['received_at']),
                    'values'=>$row['values'], 'active'=>$row['active']??[]];
            }
            return ['age_seconds' => isset($latest['time']) ? max(0, time()-$latest['time']) : null,
                'readings' => $readings, 'equipment'=>$equipment];
        });
        paw_json($result);
    }
    $hours=filter_var($_GET['hours']??24,FILTER_VALIDATE_INT);
    if(!is_int($hours)||$hours<1||$hours>24)paw_json(['error'=>'hours must be 1 to 24'],400);
    $result=paw_lock(function()use($hours):array {
        $now=time();$devices=[];
        foreach(['pawpower','tracer']as$device) {
            $days=[];$points=[];
            for($offset=0;$offset<31;$offset++) {
                $date=(new DateTimeImmutable('@'.$now))->setTimezone(new DateTimeZone('America/Detroit'))->modify('-'.$offset.' days')->format('Y-m-d');
                $day=paw_read(PAW_PRIVATE.'/history-'.$device.'-'.$date.'.json');
                if(!$day)continue;
                $days[]=paw_history_summary($day);
                foreach($day['points']as$point)if($point[0]>=$now-$hours*3600)$points[]=$point;
            }
            usort($points,static fn($a,$b)=>$a[0]<=>$b[0]);
            $devices[$device]=['days'=>$days,'points'=>$points];
        }
        return ['server_time'=>$now,'timezone'=>'America/Detroit','devices'=>$devices];
    });
    paw_json($result);
}catch(Throwable $e){
    error_log('PawPower history: '.get_class($e));
    http_response_code(503);header('Content-Type: application/json');echo '{"error":"History unavailable"}';
}
