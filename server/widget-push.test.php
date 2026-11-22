<?php
define('PAW_PRIVATE','/fixture-private');
$GLOBALS['now']=1795360000;$GLOBALS['files']=[];$GLOBALS['lock_depth']=0;$GLOBALS['messages']=[];
$GLOBALS['fcm_status']=200;$GLOBALS['fcm_reply']=[];$GLOBALS['during_send']=null;
function check(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function paw_read(string $path,array $fallback=[]):array{return $GLOBALS['files'][$path]??$fallback;}
function paw_write(string $path,array $body):void{$GLOBALS['files'][$path]=$body;}
function paw_lock(callable $fn):mixed{$GLOBALS['lock_depth']++;try{return $fn();}finally{$GLOBALS['lock_depth']--;}}
function paw_service_account():array{check($GLOBALS['lock_depth']===0,'No OAuth under global lock');return ['project_id'=>'fixture-project'];}
function paw_oauth(array $sa):string{return 'fixture-access';}
function paw_http(string $url,array $headers,string $body):array{
    check($GLOBALS['lock_depth']===0,'No network under API storage lock');
    $GLOBALS['messages'][]=json_decode($body,true,16,JSON_THROW_ON_ERROR);
    if($GLOBALS['during_send'])($GLOBALS['during_send'])();
    return [$GLOBALS['fcm_status'],$GLOBALS['fcm_reply']];
}
function reset_fixture():array{
    $id='00000000-0000-4000-8000-000000000001';$token=str_repeat('fixture-token-',8);
    $GLOBALS['files']=[PAW_PRIVATE.'/phones.json'=>['opaque-phone-key'=>['token'=>$token]],
        PAW_PRIVATE.'/history-pawpower-latest.json'=>['time'=>$GLOBALS['now']-10,
            'values'=>['battery_soc'=>68.5,'battery_voltage'=>52.5,'battery_current'=>-6]]];
    $GLOBALS['messages']=[];$GLOBALS['fcm_status']=200;$GLOBALS['fcm_reply']=[];$GLOBALS['during_send']=null;
    return [$id,$token];
}
function subscribe(string $id,string $token):array{return paw_lock(fn()=>paw_widget_subscribe(
    ['installation_id'=>$id,'enabled'=>true,'fcm_token'=>$token],$GLOBALS['now']));}
[$id,$token]=reset_fixture();
check(paw_widget_publish(['push_enabled'=>true],$GLOBALS['now'])['sent']===0,'No widgets means no messages');
check(subscribe($id,'unregistered-token-'.str_repeat('x',40))['code']===409,'Require existing phone registration');
check(subscribe($id,$token)['code']===200,'Opt in an opaque-key registered phone');
check(!str_contains(json_encode($GLOBALS['files'][PAW_PRIVATE.'/widget-subscriptions.json']),$token),'Subscription stores token hash only');
$r=paw_widget_publish(['push_enabled'=>true],$GLOBALS['now']);check($r['sent']===1,'Send enabled widget');
$m=$GLOBALS['messages'][0]['message'];
check(!isset($m['notification'])&&!isset($m['android']['notification']),'Data only, no banner');
check($m['android']['priority']==='NORMAL'&&$m['android']['ttl']==='120s','Nonurgent short-lived delivery');
check($m['android']['collapse_key']==='pawpower-widget','Latest snapshot replaces queued old data');
check($m['data']['watts']==='-315'&&$m['data']['soc']==='68.5','Signed battery power, not solar');
check($m['data']['installation_id']===$id,'Bind message to installation');
foreach($m['data']as$value)check(is_string($value),'All FCM data values are strings');
check(paw_widget_publish(['push_enabled'=>true],$GLOBALS['now']+30)['sent']===0,'Cooldown prevents rapid sends');
$GLOBALS['files'][PAW_PRIVATE.'/history-pawpower-latest.json']['time']=$GLOBALS['now']+60;
check(paw_widget_publish(['push_enabled'=>true],$GLOBALS['now']+60)['sent']===1,'Next fresh minute sends');
check(paw_widget_publish(['push_enabled'=>false],$GLOBALS['now']+120)['reason']==='push_disabled','Global push switch respected');
[$id,$token]=reset_fixture();subscribe($id,$token);
$GLOBALS['files'][PAW_PRIVATE.'/history-pawpower-latest.json']['values']['battery_current']=null;
paw_widget_publish(['push_enabled'=>true],$GLOBALS['now']);
check($GLOBALS['messages'][0]['message']['data']['watts']==='null','Missing current is not fake zero');
[$id,$token]=reset_fixture();subscribe($id,$token);
check(paw_widget_publish(['push_enabled'=>true],$GLOBALS['now']+121)['reason']==='no_fresh_battery_upload','Old uploads are not republished as fresh');
[$id,$token]=reset_fixture();subscribe($id,$token);
$GLOBALS['files'][PAW_PRIVATE.'/widget-subscriptions.json'][$id]['updated_at']=$GLOBALS['now']-PAW_WIDGET_LEASE-1;
check(paw_widget_publish(['push_enabled'=>true],$GLOBALS['now'])['sent']===0,'Expired subscription is removed');
[$id,$token]=reset_fixture();subscribe($id,$token);
$GLOBALS['fcm_status']=404;$GLOBALS['fcm_reply']=['error'=>['details'=>[['errorCode'=>'UNREGISTERED']]]];
check(paw_widget_publish(['push_enabled'=>true],$GLOBALS['now'])['failed']===1,'Failed delivery recorded');
check(!isset($GLOBALS['files'][PAW_PRIVATE.'/phones.json']['opaque-phone-key']),'Remove invalid old token');
[$id,$token]=reset_fixture();subscribe($id,$token);
$GLOBALS['fcm_status']=404;$GLOBALS['fcm_reply']=['error'=>['details'=>[['errorCode'=>'UNREGISTERED']]]];
$GLOBALS['during_send']=static function()use($id):void{
    $new=str_repeat('refreshed-token-',8);
    $GLOBALS['files'][PAW_PRIVATE.'/phones.json']['opaque-phone-key']['token']=$new;
    $GLOBALS['files'][PAW_PRIVATE.'/widget-subscriptions.json'][$id]['token_hash']=hash('sha256',$new);
};
paw_widget_publish(['push_enabled'=>true],$GLOBALS['now']);
check(isset($GLOBALS['files'][PAW_PRIVATE.'/phones.json']['opaque-phone-key']),'Late failure cannot delete refreshed token');
check(isset($GLOBALS['files'][PAW_PRIVATE.'/widget-subscriptions.json'][$id]),'Late failure cannot delete renewed subscription');
[$id,$token]=reset_fixture();subscribe($id,$token);
check(paw_widget_subscribe(['installation_id'=>$id,'enabled'=>false],$GLOBALS['now'])['code']===200,'Removing widget opts out');
check(paw_widget_publish(['push_enabled'=>true],$GLOBALS['now'])['sent']===0,'Opted-out phone gets no telemetry');
class WidgetResponse extends Exception{function __construct(public array $body,public int $status){parent::__construct();}}
function paw_json(array $body,int $status=200):never{throw new WidgetResponse($body,$status);}
function paw_config():array{return ['app_token'=>'fixture-app'];}
function paw_auth(string $expected):void{if($GLOBALS['bearer']!==$expected)paw_json(['error'=>'Unauthorized'],401);}
function paw_body():array{return $GLOBALS['request_body'];}
function endpoint(string $method,string $bearer,array $body,bool $https=true):WidgetResponse{
    $_SERVER=['REQUEST_METHOD'=>$method,'HTTPS'=>$https?'on':'off'];$GLOBALS['bearer']=$bearer;$GLOBALS['request_body']=$body;
    try{eval($GLOBALS['endpoint']);}catch(WidgetResponse $r){return $r;}throw new RuntimeException('No endpoint response');
}
check(endpoint('POST','wrong',['installation_id'=>$id,'enabled'=>false])->status===401,'Subscription requires app authentication');
check(endpoint('GET','fixture-app',[])->status===405,'No side effects through GET');
check(endpoint('POST','fixture-app',[],false)->status===400,'HTTPS required');
check(endpoint('POST','fixture-app',['installation_id'=>'../path','enabled'=>true])->status===400,'Reject caller filenames/invalid IDs');
check(endpoint('POST','fixture-app',['installation_id'=>$id,'enabled'=>false])->status===200,'Authenticated removal accepted');
echo "Widget push tests passed: opt-in, authentication, throttling, signed watts, missing data, stale uploads, silent payloads, token rotation.\n";
