<?php
class BatteryResponse extends Exception {
    function __construct(public array $body,public int $status){parent::__construct();}
}
$GLOBALS['store']=[];$GLOBALS['now']=2000;
function paw_json(array $body,int $status=200):never {throw new BatteryResponse($body,$status);}
function paw_config():array{return ['app_token'=>'app-fixture','device_tokens'=>['pawpower'=>'device-fixture']];}
function paw_auth(string $expected):void{if(!hash_equals($expected,$GLOBALS['token']))paw_json(['error'=>'Unauthorized'],401);}
function paw_read(string $path):array{return $GLOBALS['store'][$path]??[];}
function paw_write(string $path,array $value):void{$GLOBALS['store'][$path]=$value;}
function paw_lock(callable $fn):mixed{return $fn();}
function endpoint(string $method,string $token,?array $body=null,?string $device=null,bool $tls=true):BatteryResponse {
    $_SERVER=['REQUEST_METHOD'=>$method,'HTTPS'=>$tls?'on':'off'];$_GET=$device===null?[]:['device'=>$device];
    $GLOBALS['token']=$token;$GLOBALS['request_body']=json_encode($body);
    try{eval($GLOBALS['endpoint']);}catch(BatteryResponse $e){return $e;}
    throw new RuntimeException('No endpoint response');
}
check(endpoint('GET','bad')->status===401,'Reject bad token');
check(endpoint('POST','app-fixture',$report,'pawpower')->status===401,'App cannot impersonate device');
check(endpoint('POST','device-fixture',$report,'tracer')->status===401,'Tracer cannot report shunt settings');
check(endpoint('GET','app-fixture',null,null,false)->status===400,'Require TLS');
check(endpoint('GET','device-fixture',null,'pawpower')->status===405,'Device report requires POST');
check(endpoint('POST','device-fixture',$report,'pawpower')->status===200,'Device reports current state');
check(endpoint('GET','app-fixture')->body['device']['values']===$report['values'],'App reads device values');
$edit=['boot'=>$report['boot'],'revision'=>$report['revision'],'values'=>$report['values']];$edit['values'][1]=98;
check(endpoint('POST','app-fixture',$edit)->status===200,'App queues edit');
check(endpoint('POST','app-fixture',$edit)->status===409,'Concurrent replacement rejected');
check(endpoint('POST','device-fixture',$report,'pawpower')->body['command']!==null,'Only device consumes command');
echo "Battery settings endpoint auth and conflict tests passed\n";
