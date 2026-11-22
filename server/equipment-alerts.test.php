<?php
function check_equipment(bool $ok,string $why):void{if(!$ok)throw new RuntimeException($why);}
$p=paw_equipment_defaults();$p['tracer_faults']=true;$p['can_faults']=true;$p['controller_high']['enabled']=true;
$v=paw_equipment_values('tracer',['tracer_status'=>0x4001,'controller_temperature_c'=>30]);
check_equipment(!paw_tracer_fault(0x4001),'Nighttime is not a controller fault');
check_equipment(paw_tracer_fault(0x8001)&&paw_tracer_fault(3)&&paw_tracer_fault(0x2011),'Actual flags are faults');
check_equipment(count(paw_equipment_active('tracer',$v,$p))===0,'No nighttime alert');
$v['tracer_status']=3;$state=[];
foreach([10000,10030,10060]as$t){$r=paw_equipment_evaluate('tracer',$v,$p,true,$state,$t);$state=$r['state'];}
check_equipment(count($r['events'])===1,'Sustained fault alerts after confirmation delay');
$state['equipment_tracer_fault']['latched']=true;
$night=$v;$night['tracer_status']=0x4003;
$nightResult=paw_equipment_evaluate('tracer',$night,$p,true,$state,10400);
check_equipment(!$nightResult['events'],'Nighttime transition does not retrigger an existing fault');
$missing=$v;$missing['tracer_status']=null;
$r=paw_equipment_evaluate('tracer',$missing,$p,true,$state,10090);check_equipment($r['state']['equipment_tracer_fault']['latched'],'Missing data does not recover a fault');
$r=paw_equipment_evaluate('tracer',$v,$p,true,$r['state'],10400);check_equipment(count($r['events'])===0,'No repeat without recovery');
$v['tracer_status']=1;$r=paw_equipment_evaluate('tracer',$v,$p,true,$state,10430);check_equipment(!$r['state']['equipment_tracer_fault']['latched'],'Normal status rearms');
$v['controller_temperature_c']=50;$r=paw_equipment_evaluate('tracer',$v,$p,true,[],11000);
$r=paw_equipment_evaluate('tracer',$v,$p,true,$r['state'],11060);
check_equipment(count($r['events'])===1&&str_contains($r['events'][0]['message'],'122.0 °F'),'Tracer temperature alert is Fahrenheit');
$r=paw_equipment_evaluate('tracer',$v,$p,false,[],12000);$r=paw_equipment_evaluate('tracer',$v,$p,false,$r['state'],12060);check_equipment(!$r['events'],'Master off blocks equipment notifications');
$can=paw_equipment_values('pawpower',['can_fault'=>3,'tracer_status'=>65535]);check_equipment($can['tracer_status']===null,'Device cannot impersonate other equipment');
$r=paw_equipment_evaluate('pawpower',$can,$p,true,[],13000);$r=paw_equipment_evaluate('pawpower',$can,$p,true,$r['state'],13060);
check_equipment(count($r['events'])===1&&str_contains($r['events'][0]['message'],'not an internal inverter fault'),'CAN errors clearly distinguished from inverter faults');
$p['controller_high']['threshold_c']=151;try{paw_equipment_validate($p);throw new RuntimeException('Expected validation failure');}catch(InvalidArgumentException $e){}
echo "Equipment alert tests passed (nighttime, faults, temperatures, latch, recovery, master off, device separation)\n";
check_equipment(request_endpoint($equipmentEndpoint,'GET','bad')->status===401,'Equipment preferences require auth');
$get=request_endpoint($equipmentEndpoint,'GET','app-fixture');
check_equipment($get->status===200,'Equipment preferences can load');
$save=$get->body;$save['tracer_faults']=true;
$done=request_endpoint($equipmentEndpoint,'POST','app-fixture',$save);
check_equipment($done->status===200 && $done->body['revision']!==$save['revision'],'Equipment save revision changes');
check_equipment(request_endpoint($equipmentEndpoint,'POST','app-fixture',$save)->status===409,'Stale equipment save conflicts');
check_equipment(request_endpoint($monitorEndpoint,'POST','device-fixture',['readings'=>[]],'tracer')->status===401,'Battery token cannot impersonate Tracer');
$master=paw_notification_settings();$master['enabled']=true;paw_write(PAW_PRIVATE.'/notification-preferences.json',$master);
$before=$GLOBALS['pushes'];
foreach([15000,15030,15060]as$t){
 $GLOBALS['now']=$t;
 $reply=request_endpoint($monitorEndpoint,'POST','tracer-fixture',['readings'=>[],'equipment'=>['tracer_status'=>3]],'tracer');
 check_equipment($reply->status===200,'Tracer monitor accepts its own token');
}
check_equipment($GLOBALS['pushes']===$before+1,'Tracer fault pushes once through endpoint');
$GLOBALS['now']=15090;request_endpoint($monitorEndpoint,'POST','tracer-fixture',['readings'=>[],'equipment'=>['tracer_status'=>3]],'tracer');
check_equipment($GLOBALS['pushes']===$before+1,'Tracer delivery latch persists');
$all=request_endpoint($equipmentEndpoint,'GET','app-fixture')->body;
$shunt=request_endpoint($equipmentEndpoint,'GET','device-fixture',null,'pawpower');
check_equipment($shunt->status===200&&!isset($shunt->body['tracer_faults'])&&!isset($shunt->body['controller_high']),'Shunt view contains only CAN equipment settings');
$patch=['r'=>$shunt->body['revision'],'d'=>90,'c'=>true];
$reply=request_endpoint($equipmentEndpoint,'POST','device-fixture',$patch,'pawpower');
check_equipment($reply->status===200&&$reply->body['can_faults'],'Shunt can edit CAN option');
$after=request_endpoint($equipmentEndpoint,'GET','app-fixture')->body;
check_equipment($after['tracer_faults']===$all['tracer_faults']&&$after['controller_high']===$all['controller_high'],'Shunt save preserves Tracer options');
$patch['r']=$reply->body['revision'];$patch['f']=true;
check_equipment(request_endpoint($equipmentEndpoint,'POST','device-fixture',$patch,'pawpower')->status===400,'Shunt cannot submit Tracer fields');
$t=request_endpoint($equipmentEndpoint,'GET','tracer-fixture',null,'tracer')->body;
check_equipment(!isset($t['can_faults']),'Tracer view omits CAN settings');
$patch=['r'=>$t['revision'],'d'=>90,'m'=>$t['notifications_revision'],'n'=>false,'f'=>true,'h'=>[true,50],'b'=>[false,55]];
$bad=$patch;$bad['c']=false;
check_equipment(request_endpoint($equipmentEndpoint,'POST','tracer-fixture',$bad,'tracer')->status===400,'Tracer cannot submit CAN fields');
$reply=request_endpoint($equipmentEndpoint,'POST','tracer-fixture',$patch,'tracer');
check_equipment($reply->status===200&&!$reply->body['notifications_enabled'],'Tracer can edit shared Notifications master explicitly');
$after=request_endpoint($equipmentEndpoint,'GET','app-fixture')->body;
check_equipment($after['can_faults']&&$after['controller_high']['threshold_c']===50,'Tracer save preserves CAN option');
check_equipment(!paw_notification_settings()['enabled'],'Shared master change persists');
check_equipment(request_endpoint($equipmentEndpoint,'GET','app-fixture',null,'tracer')->status===401,'App token cannot impersonate Tracer device');
echo "Equipment endpoint tests passed (auth, revision conflict, Tracer delivery, device-scoped edits and master sync)\n";
