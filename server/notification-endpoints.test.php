<?php
class TestResponse extends Exception {
    public function __construct(public array $body, public int $status) { parent::__construct(); }
}
$GLOBALS['files']=[];$GLOBALS['now']=10000;$GLOBALS['pushes']=0;
function paw_json(array $body,int $status=200):never {throw new TestResponse($body,$status);}
function paw_config():array {return ['app_token'=>'app-fixture','device_tokens'=>['pawpower'=>'device-fixture','tracer'=>'tracer-fixture'],'push_enabled'=>true];}
function paw_auth(string $expected):void {if(!hash_equals($expected,$GLOBALS['bearer']))paw_json(['error'=>'Unauthorized'],401);}
function paw_read(string $path,array $fallback=[]):array {return $GLOBALS['files'][$path]??$fallback;}
function paw_write(string $path,array $body):void {$GLOBALS['files'][$path]=$body;}
function paw_lock(callable $work):mixed {return $work();}
function paw_push(array $config,string $title,string $message,string $device,string $kind):array {
    $GLOBALS['pushes']++;return ['sent'=>1,'failed'=>0];
}
function request_endpoint(string $code,string $method,string $token,?array $body=null,?string $device=null):TestResponse {
    $_SERVER=['HTTPS'=>'on','SERVER_PORT'=>'443','REQUEST_METHOD'=>$method];
    $_GET=$device===null?[]:['device'=>$device];
    $GLOBALS['bearer']=$token;$GLOBALS['request_body']=json_encode($body);
    try {eval($code);}catch(TestResponse $response){return $response;}
    throw new RuntimeException('Endpoint did not return a response');
}
$get=request_endpoint($prefEndpoint,'GET','app-fixture');
check($get->status===200 && $get->body['enabled']===false,'Defaults must disable alerts');
$initial=$get->body;
check(count($initial['preferences']['rules'])===10,'Default configuration has all rules');
check(request_endpoint($prefEndpoint,'GET','device-fixture',null,'pawpower')->body===$initial,'Both clients share saved settings');
check(request_endpoint($prefEndpoint,'GET','bad')->status===401,'App auth enforced');
check(request_endpoint($prefEndpoint,'GET','app-fixture',null,'pawpower')->status===401,'App token cannot impersonate device');
check(request_endpoint($prefEndpoint,'GET','device-fixture',null,'tracer')->status===401,'Tracer cannot edit battery rules');
$update=$initial;$update['enabled']=true;$update['preferences']['rules'][1]['enabled']=true;
$save=request_endpoint($prefEndpoint,'POST','app-fixture',$update);
check($save->status===200 && $save->body['revision']!==$initial['revision'],'Save generates fresh revision');
check(request_endpoint($prefEndpoint,'POST','device-fixture',$update,'pawpower')->status===409,'Concurrent old writer is rejected');
check(request_endpoint($prefEndpoint,'GET','app-fixture')->body===$save->body,'Conflict does not overwrite saved values');
$invalid=$save->body;$invalid['preferences']['rules'][1]['threshold']=101;
check(request_endpoint($prefEndpoint,'POST','app-fixture',$invalid)->status===400,'Invalid values rejected');
check(request_endpoint($monitorEndpoint,'POST','app-fixture',['readings'=>[]])->status===401,'Only battery device can evaluate');
foreach([0,30,60]as$dt) {
    $GLOBALS['now']=10000+$dt;
    $reply=request_endpoint($monitorEndpoint,'POST','device-fixture',['readings'=>['battery_soc'=>19]]);
    check($reply->status===200,'Monitor accepted');
}
check($GLOBALS['pushes']===1,'Confirmed event delivered exactly once');
$GLOBALS['now']+=30;
request_endpoint($monitorEndpoint,'POST','device-fixture',['readings'=>['battery_soc'=>19]]);
check($GLOBALS['pushes']===1,'Successful push persists latch');
$full=$save->body;
$compact=['r'=>$full['revision'],'e'=>false,'d'=>$full['preferences']['delay'],'l'=>[]];
$metricKeys=array_keys(paw_alert_metrics());
foreach($full['preferences']['rules']as$rule) {
    $compact['l'][]=str_starts_with($rule['id'],'custom_')
        ?[$rule['enabled']?1:0,array_search($rule['metric'],$metricKeys,true),$rule['direction']==='above'?1:0,$rule['threshold']]
        :[$rule['enabled']?1:0,$rule['threshold']];
}
$expanded=paw_alert_expand_device($compact);
check($expanded['preferences']==$full['preferences'],'Compact device protocol preserves rule values');
$compactSave=request_endpoint($prefEndpoint,'POST','device-fixture',$compact,'pawpower');
check($compactSave->status===200 && !$compactSave->body['enabled'],'Compact device save reaches shared settings');
$off=$compactSave->body;$off['enabled']=false;
check(request_endpoint($prefEndpoint,'POST','device-fixture',$off,'pawpower')->status===200,'Device can turn master off');
$GLOBALS['now']+=30;
request_endpoint($monitorEndpoint,'POST','device-fixture',['readings'=>['battery_soc'=>0]]);
check($GLOBALS['pushes']===1,'Master off prevents sending');
// Name persistence, compatibility with old clients, and explicit clearing.
$draft=request_endpoint($prefEndpoint,'GET','app-fixture')->body;
$draft['preferences']['rules'][7]['name']='Night charge';
$namedSave=request_endpoint($prefEndpoint,'POST','app-fixture',$draft);
check($namedSave->body['preferences']['rules'][7]['name']==='Night charge','App persists custom name');
$old=$namedSave->body;unset($old['preferences']['rules'][7]['name']);
$oldSave=request_endpoint($prefEndpoint,'POST','device-fixture',$old,'pawpower');
check($oldSave->body['preferences']['rules'][7]['name']==='Night charge','Old client preserves saved name');
$compact['r']=$oldSave->body['revision'];$compact['l'][7][]='New name 🐾';
$namedDevice=request_endpoint($prefEndpoint,'POST','device-fixture',$compact,'pawpower');
check($namedDevice->body['preferences']['rules'][7]['name']==='New name 🐾','Compact device saves name');
$compact['r']=$namedDevice->body['revision'];$compact['l'][7][4]='';
$cleared=request_endpoint($prefEndpoint,'POST','device-fixture',$compact,'pawpower');
check($cleared->body['preferences']['rules'][7]['name']==='','Explicit blank clears name');
// Worst escaped Unicode response must fit the existing 2 KiB ESP queue packet.
$largest=$cleared->body;
foreach($largest['preferences']['rules']as&$rule)if(str_starts_with($rule['id'],'custom_'))$rule['name']=str_repeat('é',32);unset($rule);
check(strlen(json_encode($largest))+64<2048,'Named preferences fit firmware response buffer');
echo "Notification endpoint tests passed (auth, shared persistence, conflict, invalid settings, delivery latch, master off).\n";
