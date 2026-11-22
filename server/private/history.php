<?php
declare(strict_types=1);
function paw_history_fields(): array {
    return ['battery_voltage'=>[0,1000], 'battery_current'=>[-2000,2000],
        'battery_soc'=>[0,100], 'battery_temperature_c'=>[-100,150],
        'solar_watts'=>[0,100000], 'controller_temperature_c'=>[-100,150],
        'charge_kwh_today'=>[0,10000], 'discharge_kwh_today'=>[0,10000],
        'solar_kwh_today'=>[0,10000], 'battery_capacity_ah'=>[1,10000],
        'battery_remaining_ah'=>[0,10000], 'shunt_remaining_minutes'=>[0,525600]];
}
function paw_history_values(array $input): array {
    $values=[];
    foreach(paw_history_fields() as $key=>[$min,$max]) {
        $value=$input[$key]??null;
        if($value!==null && (!(is_int($value)||is_float($value)) ||
            !is_finite((float)$value) || $value<$min || $value>$max))
            throw new InvalidArgumentException('Invalid reading');
        $values[$key]=$value;
    }
    return $values;
}
function paw_history_date(int $time): string {
    return (new DateTimeImmutable('@'.$time))->setTimezone(new DateTimeZone('America/Detroit'))->format('Y-m-d');
}
function paw_history_oldest(int $now): string {
    return (new DateTimeImmutable('@'.$now))->setTimezone(new DateTimeZone('America/Detroit'))->modify('-30 days')->format('Y-m-d');
}
function paw_history_day(string $date): array {
    return ['date'=>$date,'samples'=>0,'observed_seconds'=>0,'solar_observed_seconds'=>0,
        'charge_observed_kwh'=>0.0,'discharge_observed_kwh'=>0.0,'solar_observed_kwh'=>0.0,
        'charge_device_kwh'=>null,'discharge_device_kwh'=>null,'solar_device_kwh'=>null,
        'peaks'=>[],'points'=>[]];
}
function paw_history_power(array $v): ?float {
    return isset($v['battery_voltage'],$v['battery_current']) ?
        $v['battery_voltage']*$v['battery_current']:null;
}
function paw_history_record(array $day, array $v, ?array $previous, int $now): array {
    $day['samples']++;
    $power=paw_history_power($v);$amps=$v['battery_current'];
    $peaks=['charge_watts'=>$power===null?null:max(0,$power),
        'discharge_watts'=>$power===null?null:max(0,-$power),
        'charge_amps'=>$amps===null?null:max(0,$amps),
        'discharge_amps'=>$amps===null?null:max(0,-$amps),
        'solar_watts'=>$v['solar_watts'],'battery_temperature_c'=>$v['battery_temperature_c'],
        'controller_temperature_c'=>$v['controller_temperature_c']];
    foreach($peaks as $key=>$value) if($value!==null)
        $day['peaks'][$key]=isset($day['peaks'][$key])?max($day['peaks'][$key],$value):$value;
    foreach(['charge','discharge','solar']as$key) {
        $reading=$v[$key.'_kwh_today'];
        if($reading!==null)$day[$key.'_device_kwh']=max($day[$key.'_device_kwh']??0,$reading);
    }
    // Integrate only consecutive valid measurements; never fill an outage with invented energy.
    // The server calls this for each calendar-day slice, including DST midnight boundaries.
    if($previous!==null) {
        $dt=$now-$previous['time'];$old=$previous['values'];
        if($dt>0 && $dt<=90) {
            $start=max($previous['time'], (new DateTimeImmutable($day['date'],new DateTimeZone('America/Detroit')))->getTimestamp());
            $next=(new DateTimeImmutable($day['date'],new DateTimeZone('America/Detroit')))->modify('+1 day')->getTimestamp();
            $end=min($now,$next);$span=max(0,$end-$start);
            if($span>0) {
                $p0=paw_history_power($old);
                if($p0!==null && $power!==null) {
                    $a=$p0+($power-$p0)*($start-$previous['time'])/$dt;
                    $b=$p0+($power-$p0)*($end-$previous['time'])/$dt;
                    // Split signed linear power exactly when it crosses zero.
                    $positive=($a>=0 && $b>=0)?($a+$b)*$span/2:
                        (($a<=0 && $b<=0)?0:($a>0?$a*$a:$b*$b)*$span/(2*abs($b-$a)));
                    $net=($a+$b)*$span/2;
                    $day['charge_observed_kwh']+=$positive/3600000;
                    $day['discharge_observed_kwh']+=($positive-$net)/3600000;
                    $day['observed_seconds']+=$span;
                }
                if($old['solar_watts']!==null && $v['solar_watts']!==null) {
                    $a=$old['solar_watts']+($v['solar_watts']-$old['solar_watts'])*($start-$previous['time'])/$dt;
                    $b=$old['solar_watts']+($v['solar_watts']-$old['solar_watts'])*($end-$previous['time'])/$dt;
                    $day['solar_observed_kwh']+=($a+$b)*$span/7200000;
                    $day['solar_observed_seconds']+=$span;
                }
            }
        }
    }
    $day['points'][]=[$now,$v['battery_soc'],$power,$amps,$v['solar_watts'],
        $v['battery_temperature_c'],$v['controller_temperature_c']];
    // At most one accepted snapshot per 10 seconds; hard cap bounds private storage.
    $day['points']=array_slice($day['points'],-8640);
    return $day;
}
function paw_history_ledgers(mixed $input,int $now): array {
    if(!is_array($input)||!array_is_list($input)||count($input)>2)throw new InvalidArgumentException('Invalid ledger');
    $peaks=['charge_watts'=>[0,2000000],'discharge_watts'=>[0,2000000],
        'charge_amps'=>[0,2000],'discharge_amps'=>[0,2000],'solar_watts'=>[0,100000],
        'solar_amps'=>[0,2000],'battery_temperature_c'=>[-100,150],'controller_temperature_c'=>[-100,150]];
    $accepted=[];
    foreach($input as$row) {
        if(!is_array($row)||!is_string($row['date']??null))throw new InvalidArgumentException('Invalid ledger date');
        $date=DateTimeImmutable::createFromFormat('!Y-m-d',$row['date'],new DateTimeZone('America/Detroit'));
        if(!$date||$date->format('Y-m-d')!==$row['date']||$row['date']>paw_history_date($now))
            throw new InvalidArgumentException('Ledger date out of range');
        // A device retains its last recorded days, which may predate the cloud retention window.
        // Ignore those rows without dropping the valid current graph snapshot.
        if($row['date']<paw_history_oldest($now))continue;
        foreach(['charge_kwh','discharge_kwh','solar_kwh','seconds']as$key)if(isset($row[$key])) {
            $n=$row[$key];
            if(!(is_int($n)||is_float($n))||!is_finite((float)$n)||$n<0||$n>($key==='seconds'?90000:10000))
                throw new InvalidArgumentException('Invalid ledger value');
        }
        if(!is_bool($row['partial']??null)||!isset($row['seconds'])||!is_array($row['peaks']??null))
            throw new InvalidArgumentException('Invalid ledger metadata');
        foreach($row['peaks']as$key=>$value) {
            if(!isset($peaks[$key]))throw new InvalidArgumentException('Invalid peak');
            [$min,$max]=$peaks[$key];
            if(!(is_int($value)||is_float($value))||!is_finite((float)$value)||$value<$min||$value>$max)
                throw new InvalidArgumentException('Peak out of range');
        }
        $accepted[]=$row;
    }
    return $accepted;
}
function paw_history_merge_ledger(array $day,array $ledger,string $device): array {
    $keys=$device==='tracer'?['solar']:['charge','discharge'];
    foreach($keys as$key)if(isset($ledger[$key.'_kwh']))
        $day[$key.'_device_kwh']=max($day[$key.'_device_kwh']??0,$ledger[$key.'_kwh']);
    foreach($ledger['peaks']as$key=>$value)
        $day['peaks'][$key]=max($day['peaks'][$key]??-INF,$value);
    $day['device_seconds']=max($day['device_seconds']??0,$ledger['seconds']);
    $day['device_partial']=$ledger['partial'];$day['device_ledger']=true;$day['device_kind']=$device;
    return $day;
}
function paw_history_summary(array $day): array {
    unset($day['points']);
    $day['peaks']=(object)$day['peaks'];
    if(isset($day['device_seconds'])) {
        $key=($day['device_kind']??'')==='tracer'?'solar_observed_seconds':'observed_seconds';
        $day[$key]=max($day[$key],$day['device_seconds']);
    }
    foreach(['charge','discharge','solar']as$key) {
        $day[$key.'_kwh']=$day[$key.'_device_kwh']??(
            $day[$key==='solar'?'solar_observed_seconds':'observed_seconds']>0?$day[$key.'_observed_kwh']:null);
        $day[$key.'_source']=$day[$key.'_device_kwh']!==null?'device':'observed';
    }
    return $day;
}
