<?php
function check(bool $ok,string $message):void {if(!$ok)throw new RuntimeException($message);}
$now=(new DateTimeImmutable('2026-11-16 12:00:00',new DateTimeZone('America/Detroit')))->getTimestamp();
$v=paw_history_values(['battery_voltage'=>50,'battery_current'=>20,'solar_watts'=>1000,'battery_soc'=>13,'battery_temperature_c'=>25]);
$day=paw_history_day(paw_history_date($now));$previous=null;
for($i=0;$i<=120;$i++){
    $t=$now+$i*30;$day=paw_history_record($day,$v,$previous,$t);$previous=['time'=>$t,'values'=>$v];
}
check(abs($day['charge_observed_kwh']-1)<0.00001,'One hour at 1kW charges 1kWh');
check(abs($day['solar_observed_kwh']-1)<0.00001,'One hour solar integrates while app closed');
check($day['observed_seconds']===3600,'Coverage records observed duration');
$sum=paw_history_summary($day);
check($sum['charge_source']==='observed' && !isset($sum['points']),'Summary marks partial sampled energy');
$device=$v;$device['charge_kwh_today']=8.5;
$day=paw_history_record($day,$device,$previous,$now+3630);
check(paw_history_summary($day)['charge_kwh']===8.5,'Prefer persisted device energy totals');
$before=$day['solar_observed_kwh'];$day=paw_history_record($day,$v,['time'=>$now,'values'=>$v],$now+7200);
check($day['solar_observed_kwh']===$before,'Never integrate through an outage');
$empty=paw_history_values([]);$day=paw_history_record($day,$empty,['time'=>$now+7200,'values'=>$v],$now+7230);
check($day['solar_observed_kwh']===$before,'Null reading breaks integration');
$negative=$v;$negative['battery_current']=-20;
$cross=paw_history_record(paw_history_day(paw_history_date($now)),$v,['time'=>$now-60,'values'=>$negative],$now);
check(abs($cross['charge_observed_kwh']-1/240)<0.000001 &&
    abs($cross['discharge_observed_kwh']-1/240)<0.000001,'Signed zero-crossing integrates both directions exactly');
check($cross['peaks']['charge_watts']==1000 && $cross['peaks']['charge_amps']==20,'Daily power/current maxima');
$mid=(new DateTimeImmutable('2026-11-17 00:00:15',new DateTimeZone('America/Detroit')))->getTimestamp();
$prev=['time'=>$mid-30,'values'=>$v];
$a=paw_history_record(paw_history_day('2026-11-16'),$v,$prev,$mid);
$b=paw_history_record(paw_history_day('2026-11-17'),$v,$prev,$mid);
check(abs($a['solar_observed_kwh']-15/3600)<0.000001 &&
    abs($b['solar_observed_kwh']-15/3600)<0.000001,'Energy splits at Michigan midnight');
check(is_object(paw_history_summary(paw_history_day('2026-11-16'))['peaks']),'Empty peaks encode as object');
try{paw_history_values(['battery_soc'=>101]);throw new RuntimeException('Invalid SOC accepted');}catch(InvalidArgumentException $expected){}
echo "History tests passed: energy, signed flow, peaks, gaps, nulls, device totals, midnight, bounds.\n";
