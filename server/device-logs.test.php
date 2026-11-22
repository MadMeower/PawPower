<?php
define('PAW_PRIVATE','/log-fixture');
$GLOBALS['files']=[];$GLOBALS['now']=strtotime('2026-11-20T12:00:00Z');
function ck(bool $ok,string $why):void{if(!$ok)throw new RuntimeException($why);}
class LogResponse extends Exception{function __construct(public array $body,public int $status){parent::__construct();}}
function paw_json(array $body,int $status=200):never{throw new LogResponse($body,$status);}
function paw_config():array{return ['app_token'=>'app','device_tokens'=>['pawpower'=>'shunt','tracer'=>'solar']];}
function paw_auth(string $token):void{if($token!==$GLOBALS['token'])paw_json(['error'=>'Unauthorized'],401);}
function paw_read(string $path,array $fallback=[]):array{return $GLOBALS['files'][$path]??$fallback;}
function paw_write(string $path,array $body):void{$GLOBALS['files'][$path]=$body;}
function paw_lock(callable $f):mixed{return $f();}
function req(string $code,string $method,string $token,array $query,?array $body=null):LogResponse{
 $_SERVER=['HTTPS'=>'on','REQUEST_METHOD'=>$method];$_GET=$query;$GLOBALS['token']=$token;$GLOBALS['request_body']=json_encode($body);
 try{eval($code);}catch(LogResponse $r){return $r;}throw new RuntimeException('No response');
}
function archive(int $epoch,array $values):array{
 $hour=intdiv($epoch,3600);$data=pack('VV',0x50545231,$hour).str_repeat("\0",1920);
 $data=substr_replace($data,pack('V',$epoch).pack('g*',...$values),8+intdiv($epoch,60)%60*32,32);
 $hash=2166136261;for($i=0;$i<1928;++$i)$hash=(($hash^ord($data[$i]))*16777619)&0xffffffff;
 return ['hour'=>$hour,'hex'=>bin2hex($data.pack('V',$hash))];
}
$now=$GLOBALS['now'];$values=[90.0,10.0,900.0,52.0,-1.0,NAN,30.0];
$logs=['errors'=>['clock'=>true,'rollback'=>false,'days'=>[
 ['date'=>20261120,'omitted'=>3,'entries'=>[[$now-60,20,32770],[$now-30,20,0]]]]],
 'archive'=>archive($now-60,$values)];
$valid=paw_log_validate($logs,'tracer',$now);ck($valid['rows'][0][6]===null,'NaN becomes unavailable');
try{paw_log_validate($logs,'pawpower',$now);throw new RuntimeException('Role isolation failed');}catch(InvalidArgumentException $e){}
$bad=$logs;$bad['archive']['hex'][40]=$bad['archive']['hex'][40]==='a'?'b':'a';
try{paw_log_validate($bad,'tracer',$now);throw new RuntimeException('Corruption accepted');}catch(InvalidArgumentException $e){}
try{paw_log_validate(['archive'=>archive($now-60,[90,10,INF,52,1,25,30])],'tracer',$now);throw new RuntimeException('Infinity accepted');}catch(InvalidArgumentException $e){}
ck(req($historyEndpoint,'POST','app',['device'=>'tracer'],['readings'=>[],'logs'=>$logs])->status===401,'App cannot upload');
$reply=req($historyEndpoint,'POST','solar',['device'=>'tracer'],['readings'=>[],'logs'=>$logs]);
ck($reply->status===200&&$reply->body['logs']===true,'Uploader receives explicit log acknowledgement');
$reply=req($historyEndpoint,'POST','solar',['device'=>'tracer'],['readings'=>[],'logs'=>$logs]);
ck(!isset($reply->body['logs']),'Rate-limited packets are not falsely acknowledged');
$GLOBALS['now']+=30;
$reply=req($historyEndpoint,'POST','solar',['device'=>'tracer'],['readings'=>[],'logs'=>$logs]);
ck($reply->body['logs']===true,'Retry is persisted and acknowledged');
$view=req($logEndpoint,'GET','app',['device'=>'tracer','date'=>'2026-11-20']);
ck(count($view->body['readings'])===1&&count($view->body['errors'])===2&&$view->body['omitted']===3,'Stored day visible to phone, replay idempotent');
ck(req($logEndpoint,'GET','solar',['device'=>'tracer','date'=>'2026-11-20'])->status===401,'Device token cannot read phone endpoint');
ck(req($logEndpoint,'GET','app',['device'=>'../secret','date'=>'2026-11-20'])->status===400,'Path traversal blocked');
ck(req($logEndpoint,'GET','app',['device'=>'tracer','date'=>'2026-11-13'])->status===400,'Seven-day read limit enforced');
ck(req($logEndpoint,'GET','app',['device'=>'pawpower','date'=>'2026-11-20'])->body['readings']===[],'Shunt cannot see Tracer readings');
ck(req($historyEndpoint,'POST','shunt',['device'=>'pawpower'],['readings'=>[]])->status===200,'Legacy uploads unchanged');
$old=paw_log_validate(['archive'=>archive($now-8*86400,$values)],'tracer',$now);ck(!$old['rows'],'Expired archive rows ignored');
echo "Device log tests passed: auth, roles, CRC, unavailable readings, persistence, replay, legacy compatibility and seven-day window.\n";
