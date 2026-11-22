<?php
declare(strict_types=1);
// Uses the existing private backend.php helpers, registered phones and Firebase account.
const PAW_WIDGET_LEASE = 604800;
function paw_widget_uuid(mixed $id): bool {
    return is_string($id) && preg_match('/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/Di', $id) === 1;
}
function paw_widget_subscribe(array $body, int $now): array {
    $id=$body['installation_id']??null; $enabled=$body['enabled']??null;
    if(!paw_widget_uuid($id)||!is_bool($enabled))return ['code'=>400,'body'=>['error'=>'Invalid subscription']];
    $path=PAW_PRIVATE.'/widget-subscriptions.json';$subscriptions=paw_read($path);
    if(!$enabled){unset($subscriptions[$id]);paw_write($path,$subscriptions);return ['code'=>200,'body'=>['ok'=>true,'enabled'=>false]];}
    $token=$body['fcm_token']??null;
    if(!is_string($token)||strlen($token)<32||strlen($token)>4096)return ['code'=>400,'body'=>['error'=>'Invalid phone registration']];
    // Match the existing phone token; do not assume how api.php keys its phone records.
    $phoneKey=null;
    foreach(paw_read(PAW_PRIVATE.'/phones.json') as$key=>$phone)
        if(is_string($phone['token']??null)&&hash_equals($phone['token'],$token)){$phoneKey=(string)$key;break;}
    if($phoneKey===null)return ['code'=>409,'body'=>['error'=>'Register this phone first']];
    foreach($subscriptions as$key=>$sub)
        if(($sub['updated_at']??0)<$now-PAW_WIDGET_LEASE||(($sub['phone_key']??null)===$phoneKey&&$key!==$id))unset($subscriptions[$key]);
    if(!isset($subscriptions[$id])&&count($subscriptions)>=5)return ['code'=>409,'body'=>['error'=>'Widget phone limit reached']];
    $subscriptions[$id]=['phone_key'=>$phoneKey,'token_hash'=>hash('sha256',$token),'updated_at'=>$now];
    paw_write($path,$subscriptions);
    return ['code'=>200,'body'=>['ok'=>true,'enabled'=>true]];
}
function paw_widget_number(mixed $value,float $min,float $max): ?float {
    return (is_int($value)||is_float($value))&&is_finite((float)$value)&&$value>=$min&&$value<=$max?(float)$value:null;
}
function paw_widget_claim(array $config,int $now): array {
    if(!($config['push_enabled']??false))return ['reason'=>'push_disabled','jobs'=>[]];
    $latest=paw_read(PAW_PRIVATE.'/history-pawpower-latest.json');$sample=$latest['time']??null;
    if(!is_int($sample)||$sample<=0||$sample>$now+5||$now-$sample>120)return ['reason'=>'no_fresh_battery_upload','jobs'=>[]];
    $values=$latest['values']??[];
    $soc=paw_widget_number($values['battery_soc']??null,0,100);
    $volts=paw_widget_number($values['battery_voltage']??null,0,1000);
    $amps=paw_widget_number($values['battery_current']??null,-2000,2000);
    $watts=$volts===null||$amps===null?null:round($volts*$amps,2);
    $subscriptions=paw_read(PAW_PRIVATE.'/widget-subscriptions.json');$phones=paw_read(PAW_PRIVATE.'/phones.json');
    $state=paw_read(PAW_PRIVATE.'/widget-push-state.json');$jobs=[];
    foreach($subscriptions as$id=>$sub){
        $key=$sub['phone_key']??'';$phone=$phones[$key]??null;$token=$phone['token']??null;
        if(!paw_widget_uuid($id)||!is_string($token)||!is_string($sub['token_hash']??null)||
            !hash_equals($sub['token_hash'],hash('sha256',$token))||
            ($sub['updated_at']??0)<$now-PAW_WIDGET_LEASE){unset($subscriptions[$id],$state[$id]);continue;}
        $old=$state[$id]??[];
        if(($old['attempted_at']??0)>$now-60||($old['sample_time']??0)>=$sample)continue;
        // Claim before outbound HTTPS, under the global storage lock.
        $state[$id]=['attempted_at'=>$now,'sample_time'=>$sample];
        $jobs[]=['id'=>$id,'phone_key'=>$key,'token'=>$token,'data'=>[
            'type'=>'pawpower_widget_v1','installation_id'=>$id,
            'sample_time'=>(string)$sample,'sent_time'=>(string)$now,
            'soc'=>json_encode($soc,JSON_THROW_ON_ERROR),'watts'=>json_encode($watts,JSON_THROW_ON_ERROR)]];
    }
    $state=array_intersect_key($state,$subscriptions);
    paw_write(PAW_PRIVATE.'/widget-subscriptions.json',$subscriptions);
    paw_write(PAW_PRIVATE.'/widget-push-state.json',$state);
    return ['reason'=>$jobs?'':'no_due_widget','jobs'=>$jobs];
}
function paw_widget_publish(array $config,int $now): array {
    $claim=paw_lock(static fn()=>paw_widget_claim($config,$now));
    if(!$claim['jobs'])return ['sent'=>0,'failed'=>0,'reason'=>$claim['reason']];
    // No Firebase or network operations while holding the shared API storage lock.
    $sa=paw_service_account();$access=paw_oauth($sa);$sent=0;$failed=0;
    foreach($claim['jobs']as$job){
        try{
            [$status,$reply]=paw_http('https://fcm.googleapis.com/v1/projects/'.$sa['project_id'].'/messages:send',
                ['Authorization: Bearer '.$access,'Content-Type: application/json'],
                json_encode(['message'=>['token'=>$job['token'],'data'=>$job['data'],
                    'android'=>['priority'=>'NORMAL','ttl'=>'120s','collapse_key'=>'pawpower-widget']]],
                    JSON_THROW_ON_ERROR));
            if($status===200)++$sent;else ++$failed;
            foreach(($reply['error']['details']??[])as$detail)if(($detail['errorCode']??'')==='UNREGISTERED'){
                paw_lock(static function()use($job):void{
                    $phones=paw_read(PAW_PRIVATE.'/phones.json');$subscriptions=paw_read(PAW_PRIVATE.'/widget-subscriptions.json');
                    $current=$phones[$job['phone_key']]['token']??null;
                    if(is_string($current)&&hash_equals($current,$job['token'])){unset($phones[$job['phone_key']]);paw_write(PAW_PRIVATE.'/phones.json',$phones);}
                    if(($subscriptions[$job['id']]['token_hash']??'')===hash('sha256',$job['token'])){
                        unset($subscriptions[$job['id']]);paw_write(PAW_PRIVATE.'/widget-subscriptions.json',$subscriptions);
                    }
                });
            }
        }catch(Throwable $error){++$failed;error_log('PawPower widget delivery: '.get_class($error));}
    }
    return ['sent'=>$sent,'failed'=>$failed];
}
