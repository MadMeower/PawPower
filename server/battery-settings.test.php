<?php
function check(bool $ok,string $why):void {if(!$ok)throw new RuntimeException($why);}
$v=[1120,95,93,56.8,54,125,140,48,50.8,49,1,2,5,1,45,40,20,25];
$report=['boot'=>'0123456789abcdef','revision'=>1,'saved'=>true,'values'=>$v];
[$code,$s,$view]=paw_battery_step([],$report,true,1000);
check($code===200 && $view['command']===null,'First report never changes settings');
$update=['boot'=>$report['boot'],'revision'=>1,'values'=>$v];$update['values'][1]=96;
[$code,$s,$view]=paw_battery_step($s,$update,false,1001);check($s['pending']!==null,'Change queued');
$id=$s['pending']['id'];
[$code,$other]=paw_battery_step($s,$update,false,1002);check($code===409,'Pending change cannot be replaced');
[$code,$s,$view]=paw_battery_step($s,$report,true,1030);check($view['command']['id']===$id,'Device receives same id until acknowledgement');
$report['values']=$update['values'];$report['revision']=2;$report['ack']=['id'=>$id,'applied'=>true];
[$code,$s]=paw_battery_step($s,$report,true,1060);check($s['pending']===null && $s['result']==='Saved on shunt','Only device acknowledgement confirms save');
$update['revision']=2;$update['values'][1]=97;
[$code,$s]=paw_battery_step($s,$update,false,1061);
$report['boot']='fedcba9876543210';
[$code,$s]=paw_battery_step($s,$report,true,1090);check($s['pending']===null,'Reboot cancels request');
$update['boot']=$report['boot'];[$code,$s]=paw_battery_step($s,$update,false,1091);
[$code,$s]=paw_battery_step($s,null,false,1211);check($s['pending']===null,'Request expires');
[$code]=$r=paw_battery_step($s,$update,false,1300);check($code===409,'Offline device cannot accept settings');
$bad=$v;$bad[1]=101;try{paw_battery_validate($bad);throw new RuntimeException('Expected rejection');}catch(InvalidArgumentException $e){}
$bad=$v;$bad[17]=19;try{paw_battery_validate($bad);throw new RuntimeException('Expected rejection');}catch(InvalidArgumentException $e){}
echo "Battery settings state-machine tests passed\n";
