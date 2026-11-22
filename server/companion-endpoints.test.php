<?php
class TestResponse extends Exception {
    function __construct(public array $body,public int $status){parent::__construct();}
}
$GLOBALS['files']=[];$GLOBALS['now']=1794848400;$GLOBALS['push_count']=0;$GLOBALS['push_enabled']=true;
function paw_json(array $body,int $status=200):never{throw new TestResponse($body,$status);}
function paw_config():array{return ['app_token'=>'fixture-app','device_tokens'=>['pawpower'=>'fixture-battery','tracer'=>'fixture-tracer'],'push_enabled'=>$GLOBALS['push_enabled']];}
function paw_auth(string $expected):void{if(!hash_equals($expected,$GLOBALS['bearer']))paw_json(['error'=>'Unauthorized'],401);}
function paw_read(string $path,array $fallback=[]):array{return $GLOBALS['files'][$path]??$fallback;}
function paw_write(string $path,array $data):void{$GLOBALS['files'][$path]=$data;}
function paw_lock(callable $callback):mixed{return $callback();}
function paw_push(array $config,string $title,string $message,string $device,string $kind):array {
    $GLOBALS['push_count']++;check($title==='PawPower test'&&$kind==='test','Only fixed test messages allowed');
    return ['sent'=>1,'failed'=>0];
}
function request(string $code,string $method,string $token,array $query=[],array $body=[]):TestResponse {
    $_SERVER=['HTTPS'=>'on','SERVER_PORT'=>'443','REQUEST_METHOD'=>$method];$_GET=$query;
    $GLOBALS['bearer']=$token;$GLOBALS['request_body']=json_encode($body);
    try{eval($code);}catch(TestResponse $response){return $response;}
    throw new RuntimeException('No response');
}
check(request($historyEndpoint,'GET','wrong')->status===401,'History requires app authentication');
check(request($historyEndpoint,'GET','wrong',['latest'=>'1'])->status===401,'Live timing requires app authentication');
$timing = ['battery_current'=>20,'battery_capacity_ah'=>200,'battery_remaining_ah'=>150,'shunt_remaining_minutes'=>90];
check(request($historyEndpoint,'POST','fixture-battery',['device'=>'pawpower'],['readings'=>$timing])->status===200,'Battery timing uploads');
$latest = request($historyEndpoint,'GET','fixture-app',['latest'=>'1']);
check($latest->body['readings']['battery_capacity_ah']===200,'Configured capacity returned');
check($latest->body['age_seconds']===0,'Live timing age returned');
check(request($historyEndpoint,'POST','fixture-app',['device'=>'pawpower'])->status===401,'Read token cannot upload');
check(request($historyEndpoint,'GET','fixture-app',['hours'=>25])->status===400,'Bound history range');
$stamp=$GLOBALS['now'];$date=paw_history_date($stamp);
$ledger=['date'=>$date,'solar_kwh'=>2.5,'seconds'=>7200,'partial'=>true,'peaks'=>['solar_watts'=>1800]];
$body=['readings'=>['solar_watts'=>1000],'days'=>[$ledger]];
check(request($historyEndpoint,'POST','fixture-tracer',['device'=>'tracer'],$body)->status===200,'Device uploads accepted');
$get=request($historyEndpoint,'GET','fixture-app');
$tracer=$get->body['devices']['tracer'];
check($tracer['days'][0]['solar_kwh']===2.5,'Device solar total persisted');
check($tracer['days'][0]['peaks']->solar_watts===1800,'Saved device peak preferred');
check(count($tracer['points'])===1,'Store graph sample');
check(request($historyEndpoint,'POST','fixture-tracer',['device'=>'tracer'],$body)->body['reason']==='rate_limited','Bound sample rate');
$GLOBALS['now']+=30;
$old=$ledger;$old['date']=paw_history_date($stamp-40*86400);
check(request($historyEndpoint,'POST','fixture-tracer',['device'=>'tracer'],['readings'=>['solar_watts'=>500],'days'=>[$old]])->status===200,'Old device ledger does not block current readings');
check(count(request($historyEndpoint,'GET','fixture-app')->body['devices']['tracer']['points'])===2,'Continue graph collection when device has very old ledger slots');
check(request($testEndpoint,'POST','wrong',['device'=>'pawpower'])->status===401,'Test endpoint authenticates device');
check(request($testEndpoint,'GET','fixture-battery',['device'=>'pawpower'])->status===405,'Tests require POST');
check(request($testEndpoint,'POST','fixture-battery',['device'=>'pawpower'],['message'=>'ignored'])->body['sent']===1,'Working push helper used');
$GLOBALS['now']+=30;
check(request($testEndpoint,'POST','fixture-tracer',['device'=>'tracer'])->body['reason']==='cooldown','Cooldown shared across webpages');
check($GLOBALS['push_count']===1,'No repeated rapid send');
$GLOBALS['now']+=30;
check(request($testEndpoint,'POST','fixture-tracer',['device'=>'tracer'])->body['sent']===1,'Cooldown expires after 60 seconds');
$GLOBALS['push_enabled']=false;
check(request($testEndpoint,'POST','fixture-battery',['device'=>'pawpower'])->body['reason']==='push_disabled','Disabled push reported honestly');
echo "Companion endpoint tests passed: auth, history persistence, device ledger, sampling, fixed test messages, global cooldown.\n";
