<?php
declare(strict_types=1);
function paw_equipment_defaults():array {
    return ['revision'=>bin2hex(random_bytes(16)),'delay'=>60,'tracer_faults'=>false,'can_faults'=>false,
        'controller_high'=>['enabled'=>false,'threshold_c'=>45],
        'battery_high'=>['enabled'=>false,'threshold_c'=>45]];
}
function paw_equipment_settings():array {
    $path=PAW_PRIVATE.'/equipment-preferences.json';$s=paw_read($path);
    if(!$s){$s=paw_equipment_defaults();paw_write($path,$s);}return $s;
}
function paw_equipment_validate(array $s):array {
    if(!is_string($s['revision']??null)||!preg_match('/^[a-f0-9]{32}$/D',$s['revision']) ||
        !is_int($s['delay']??null)||$s['delay']<30||$s['delay']>600 ||
        !is_bool($s['tracer_faults']??null)||!is_bool($s['can_faults']??null))throw new InvalidArgumentException();
    $out=array_intersect_key($s,array_flip(['revision','delay','tracer_faults','can_faults']));
    foreach(['controller_high','battery_high']as$key) {
        $r=$s[$key]??null;$n=$r['threshold_c']??null;
        if(!is_array($r)||!is_bool($r['enabled']??null)||!paw_alert_number($n)||$n< -100||$n>150)throw new InvalidArgumentException();
        $out[$key]=['enabled'=>$r['enabled'],'threshold_c'=>$n];
    }
    return $out;
}
function paw_equipment_view(array $s,?string $device,array $master):array {
    if($device==='pawpower')$s=array_intersect_key($s,array_flip(['revision','delay','can_faults']));
    elseif($device==='tracer')$s=array_intersect_key($s,array_flip(['revision','delay','tracer_faults','controller_high','battery_high']));
    $s['notifications_enabled']=$master['enabled'];$s['notifications_revision']=$master['revision'];
    return $s;
}
function paw_equipment_device_patch(string $device,array $body,array $current):array {
    $keys=$device==='pawpower'?['r','d','c']:['r','d','m','n','f','h','b'];
    if(count($body)!==count($keys)||array_diff(array_keys($body),$keys))throw new InvalidArgumentException('Unexpected device fields');
    $next=$current;$next['revision']=$body['r'];$next['delay']=$body['d'];
    if($device==='pawpower')$next['can_faults']=$body['c'];
    else {
        if(!is_string($body['m'])||!preg_match('/^[a-f0-9]{32}$/D',$body['m'])||!is_bool($body['n']))throw new InvalidArgumentException();
        $next['tracer_faults']=$body['f'];
        foreach(['h'=>'controller_high','b'=>'battery_high']as$key=>$field) {
            $v=$body[$key];
            if(!is_array($v)||!array_is_list($v)||count($v)!==2)throw new InvalidArgumentException();
            $next[$field]=['enabled'=>$v[0],'threshold_c'=>$v[1]];
        }
    }
    return paw_equipment_validate($next);
}
function paw_equipment_values(string $device,mixed $input):array {
    if($input===null)$input=[];
    if(!is_array($input))throw new InvalidArgumentException();
    $out=[];
    foreach(['tracer_status','can_fault','controller_temperature_c','battery_temperature_c']as$key) {
        $n=$input[$key]??null;
        if($n!==null) {
            if(!paw_alert_number($n))throw new InvalidArgumentException();
            if(in_array($key,['tracer_status','can_fault'],true)) {
                if(floor($n)!=$n||$n<0||$n>($key==='can_fault'?7:65535))throw new InvalidArgumentException();
                $n=(int)$n;
            }elseif($n< -100||$n>150)throw new InvalidArgumentException();
        }
        $out[$key]=$n;
    }
    // A controller token cannot supply inverter/CAN status, or vice versa.
    if($device==='tracer')$out['can_fault']=null;
    else {$out['tracer_status']=null;$out['controller_temperature_c']=null;$out['battery_temperature_c']=null;}
    return $out;
}
function paw_tracer_fault_bits(int $status):int {
    // Ignore stage/running bits and normal nighttime "no input power" (01).
    return ($status & 0x3fd2) | ((($status>>14)&3)>=2?($status & 0xc000):0);
}
function paw_tracer_fault(int $status):bool {return paw_tracer_fault_bits($status)!==0;}
function paw_can_fault_text(int $code):string {
    return [0=>'No CAN error',1=>'CAN initialization failed',2=>'CAN status read failed',
        3=>'CAN bus-off/recovery',4=>'CAN start failed',5=>'CAN transmit backlog',
        6=>'CAN transmit failed',7=>'CAN transmission errors'][$code]??'Unknown CAN error';
}
function paw_equipment_rules(string $device,array $v,array $s):array {
    if($device==='pawpower') {
        $code=$v['can_fault'];
        return ['equipment_can_fault'=>['enabled'=>$s['can_faults'],'value'=>$code,
            'hit'=>$code===null?null:$code>0,'recovered'=>$code===0,'fingerprint'=>$code,
            'title'=>'6000XP CAN link error','message'=>$code===null?'CAN status unavailable':paw_can_fault_text($code).'. This is a CAN link error, not an internal inverter fault code.']];
    }
    $status=$v['tracer_status'];
    $rules=['equipment_tracer_fault'=>['enabled'=>$s['tracer_faults'],'value'=>$status,
        'hit'=>$status===null?null:paw_tracer_fault($status),'recovered'=>$status!==null&&!paw_tracer_fault($status),
        'fingerprint'=>$status===null?null:paw_tracer_fault_bits($status),
        'title'=>'Tracer controller fault','message'=>$status===null?'Status unavailable':sprintf('Tracer reported charging status 0x%04X. Check its local status and controller.',$status)]];
    foreach(['controller_high'=>'controller_temperature_c','battery_high'=>'battery_temperature_c']as$key=>$metric) {
        $n=$v[$metric];$limit=$s[$key]['threshold_c'];
        $rules['equipment_'.$key]=['enabled'=>$s[$key]['enabled'],'value'=>$n,'hit'=>$n===null?null:$n>=$limit,
            'recovered'=>$n!==null&&$n<$limit-2,'fingerprint'=>$limit,
            'title'=>$key==='controller_high'?'Tracer high controller temperature':'Tracer high battery probe temperature',
            'message'=>$n===null?'Temperature unavailable':sprintf('Tracer %s: %.1f °F (limit %.1f °F).',
                $key==='controller_high'?'controller':'battery probe',$n*1.8+32,$limit*1.8+32)];
    }
    return $rules;
}
function paw_equipment_active(string $device,array $v,array $s):array {
    $active=[];
    foreach(paw_equipment_rules($device,$v,$s)as$r)if($r['hit']===true)$active[]=$r['message'];
    return $active;
}
function paw_equipment_evaluate(string $device,array $v,array $prefs,bool $enabled,array $old,int $now):array {
    $state=[];$events=[];
    foreach(paw_equipment_rules($device,$v,$prefs)as$id=>$rule) {
        $prev=$old[$id]??[];
        $condition=$rule['hit']===null?($prev['condition']??$rule['fingerprint']):$rule['fingerprint'];
        $fp=hash('sha256',json_encode([$prefs['delay'],$rule['enabled'],$condition],JSON_THROW_ON_ERROR));
        $same=($prev['fingerprint']??'')===$fp;
        $s=['fingerprint'=>$fp,'condition'=>$condition,'since'=>$same?($prev['since']??null):null,'last'=>$now,
            'latched'=>$same?($prev['latched']??false):false,'attempted'=>$prev['attempted']??0];
        if(!$enabled||!$rule['enabled']) {$s['since']=null;$s['latched']=false;}
        elseif($rule['hit']===null) {$s['since']=null;}
        elseif($rule['recovered']) {$s['since']=null;$s['latched']=false;}
        elseif(!$rule['hit'])$s['since']=null;
        elseif(!$s['latched']) {
            if($s['since']===null||$now-($prev['last']??0)>90||$now<($prev['last']??0))$s['since']=$now;
            if($now-$s['since']>=$prefs['delay'] && $now-$s['attempted']>=300) {
                $events[]=['id'=>$id,'title'=>$rule['title'],'message'=>$rule['message']];$s['attempted']=$now;
            }
        }
        $state[$id]=$s;
    }
    return ['state'=>$state,'events'=>$events];
}
