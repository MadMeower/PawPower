<?php
declare(strict_types=1);
function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function fixture(): array {
    $definitions = paw_alert_definitions();
    $thresholds = [12,20,0,45,55,0.5,99,15,10,50]; $rules = []; $i = 0;
    foreach ($definitions as $id => [$metric,$direction,$_]) {
        $rules[] = ['id'=>$id,'metric'=>$metric ?? 'battery_soc','direction'=>$direction ?? 'below',
            'threshold'=>$thresholds[$i++],'enabled'=>$id === 'low_soc'];
    }
    return paw_alert_validate(['version'=>1,'delay'=>60,'rules'=>$rules]);
}
$p = fixture();
$s = []; $base = 10000;
foreach ([0,30] as $dt) {
    $r = paw_alert_evaluate($p,true,['battery_soc'=>20],$s,$base+$dt);
    check(count($r['events'])===0,'Must confirm consecutive samples'); $s=$r['state'];
}
$r = paw_alert_evaluate($p,true,['battery_soc'=>20],$s,$base+60);
check(count($r['events'])===1 && $r['events'][0]['id']==='low_soc','Inclusive threshold at delay');
$s=$r['state']; $s['low_soc']['latched']=true;
foreach ([90=>null,120=>21,150=>20] as $dt=>$value) {
    $r=paw_alert_evaluate($p,true,['battery_soc'=>$value],$s,$base+$dt);
    check(!$r['events'],'Stale or jitter must not re-arm'); $s=$r['state'];
}
$r=paw_alert_evaluate($p,true,['battery_soc'=>23],$s,$base+180);
check(!$r['state']['low_soc']['latched'],'Recovery outside margin re-arms');$s=$r['state'];
foreach ([300,330,360] as $dt) {$r=paw_alert_evaluate($p,true,['battery_soc'=>19],$s,$base+$dt);$s=$r['state'];}
check(count($r['events'])===1,'Second episode after recovery');
$r=paw_alert_evaluate($p,true,['battery_soc'=>19],$s,$base+390);
check(!$r['events'],'Failed send cannot retry before cooldown');
$s=[];foreach ([0,30,200] as $dt) {$r=paw_alert_evaluate($p,true,['battery_soc'=>10],$s,$base+$dt);$s=$r['state'];}
check(!$r['events'] && $s['low_soc']['since']===$base+200,'Telemetry gap resets dwell');
foreach ([null,NAN,INF,-1,101] as $value) {
    $r=paw_alert_evaluate($p,true,['battery_soc'=>$value],$s,$base+230);
    check(!$r['events'] && $r['state']['low_soc']['since']===null,'Invalid samples never notify');
}
$r=paw_alert_evaluate($p,false,['battery_soc'=>0],$s,$base+260);
check(!$r['events'] && !$r['state']['low_soc']['latched'],'Master off resets episodes');
foreach ($p['rules'] as $index=>$rule) {
    $q=$p;foreach($q['rules'] as &$x)$x['enabled']=false;unset($x);
    $q['rules'][$index]['enabled']=true;
    $value=$rule['threshold'];$state=[];
    foreach([0,30,60]as$dt){$r=paw_alert_evaluate($q,true,[$rule['metric']=>$value],$state,$base+$dt);$state=$r['state'];}
    check(count($r['events'])===1 && $r['events'][0]['id']===$rule['id'],'Each rule triggers independently: '.$rule['id']);
    if($rule['metric']==='battery_temperature_c')
        check(str_contains($r['events'][0]['message'],'°F') && !str_contains($r['events'][0]['message'],'°C'),'Temperature notifications use Fahrenheit');
}
$invalid=$p;$invalid['rules'][3]['threshold']=-1;
try{paw_alert_validate($invalid);throw new RuntimeException('Invalid ordering accepted');}catch(InvalidArgumentException $expected){}
$invalid=$p;$invalid['rules'][0]['metric']='battery_soc';
try{paw_alert_validate($invalid);throw new RuntimeException('Fixed metric changed');}catch(InvalidArgumentException $expected){}
$invalid=$p;$invalid['rules'][1]=$invalid['rules'][0];
try{paw_alert_validate($invalid);throw new RuntimeException('Duplicate accepted');}catch(InvalidArgumentException $expected){}
// Optional names drive titles without changing episode identity.
$named=fixture();
foreach($named['rules']as&$rule) {
    $rule['enabled']=$rule['id']==='custom_1';
    if($rule['id']==='custom_1')$rule['name']='  Time to charge 🐾  ';
}unset($rule);
$named=paw_alert_validate($named);$state=[];
foreach([0,30,60]as$dt){$r=paw_alert_evaluate($named,true,['battery_soc'=>10],$state,$base+$dt);$state=$r['state'];}
check($r['events'][0]['title']==='Time to charge 🐾','Named alert title is trimmed and delivered');
$state['custom_1']['latched']=true;
$named['rules'][7]['name']='Renamed alert';
$r=paw_alert_evaluate($named,true,['battery_soc'=>10],$state,$base+90);
check(!$r['events']&&$r['state']['custom_1']['latched'],'Renaming must preserve episode latch');
foreach([str_repeat('x',33),"bad\nname",str_repeat('🐾',17),123]as$name) {
    $bad=fixture();$bad['rules'][7]['name']=$name;
    try{paw_alert_validate($bad);throw new RuntimeException('Invalid name accepted');}catch(InvalidArgumentException $expected){}
}
$named['rules'][7]['name']='';
$named=paw_alert_validate($named);$state=[];
foreach([0,30,60]as$dt){$r=paw_alert_evaluate($named,true,['battery_soc'=>10],$state,$base+$dt);$state=$r['state'];}
check($r['events'][0]['title']==='Custom battery alert 1','Blank name uses default title');
echo "Notification rule tests passed (delay, boundary, recovery, stale, gaps, cooldown, master off, all 10 rules, validation).\n";
