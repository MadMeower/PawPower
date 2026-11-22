<?php
declare(strict_types=1);
function paw_battery_validate(mixed $v): array {
    if (!is_array($v) || !array_is_list($v) || count($v)!==18) throw new InvalidArgumentException('Eighteen values required');
    $lo=[1,50,0,48,40,1,1,40,40,40,0,-100,-100,0,-100,-100,0,0];
    $hi=[10000,100,99,60,60,600,600,56,60,60,1,150,150,1,150,150,100,100];
    foreach($v as $i=>$n) {
        if ((!is_int($n)&&!is_float($n)) || !is_finite((float)$n) || $n<$lo[$i] || $n>$hi[$i])
            throw new InvalidArgumentException('Value outside supported range');
        if (!in_array($i,[11,12,14,15],true) && abs($n*10-round($n*10))>0.001)
            throw new InvalidArgumentException('Use at most one decimal place');
    }
    if ($v[2]>$v[1]-1 || $v[17]<$v[16]+1 || $v[7]>=$v[4] || $v[4]>$v[3] ||
        $v[8]<$v[7]+0.5 || $v[8]>=$v[3] || $v[9]<$v[7] || $v[9]>$v[8] ||
        !in_array($v[10],[0,1,0.0,1.0],true) || !in_array($v[13],[0,1,0.0,1.0],true) ||
        $v[12]<=$v[11] || $v[15]>=$v[14]) throw new InvalidArgumentException('Check stop/resume and voltage order');
    return $v;
}
function paw_battery_step(array $saved, ?array $body, bool $device, int $now): array {
    $pending=$saved['pending']??null;
    if ($pending && $pending['expires_at']<=$now) {$pending=null;$saved['result']='Expired without device confirmation';}
    if ($device) {
        if (!is_array($body) || !is_string($body['boot']??null) || !preg_match('/^[a-f0-9]{16}$/D',$body['boot']) ||
            !is_int($body['revision']??null) || $body['revision']<0 || $body['revision']>4294967295 ||
            !is_bool($body['saved']??null)) throw new InvalidArgumentException('Invalid device state');
        $values=paw_battery_validate($body['values']??null);
        $old=$saved['device']??null;
        if ($pending) {
            $ack=$body['ack']??null;
            if (is_array($ack) && ($ack['id']??'')===$pending['id']) {
                $matches=true;foreach($values as $i=>$n)if(abs($n-$pending['values'][$i])>0.0006)$matches=false;
                $saved['result']=($ack['applied']??false)===true && $body['saved'] && $matches &&
                    $body['boot']===$pending['boot'] && $body['revision']===$pending['revision']+1
                    ?'Saved on shunt':'Device rejected change; reload settings';
                $pending=null;
            } elseif ($body['boot']!==$pending['boot'] || $body['revision']!==$pending['revision']) {
                $pending=null;$saved['result']='Device restarted or settings changed; request cancelled';
            }
        }
        $saved['device']=['boot'=>$body['boot'],'revision'=>$body['revision'],'saved'=>$body['saved'],
            'values'=>$values,'received_at'=>$now];
    } elseif ($body!==null) {
        $current=$saved['device']??null;
        if (!$current || $current['received_at']<$now-90) return [409,$saved,['error'=>'Shunt is offline; reload when connected']];
        if ($pending || ($body['boot']??null)!==$current['boot'] || ($body['revision']??null)!==$current['revision'])
            return [409,$saved,['error'=>'Settings changed or a request is pending. Reload first']];
        $values=paw_battery_validate($body['values']??null);
        if ($current['saved'] && $values==$current['values']) {$saved['pending']=null;$saved['result']='Already saved on shunt';$saved['server_time']=$now;return [200,$saved,$saved];}
        if ($current['revision']>=4294967295) throw new InvalidArgumentException('Revision exhausted');
        $pending=['id'=>bin2hex(random_bytes(16)),'boot'=>$current['boot'],'revision'=>$current['revision'],
            'values'=>$values,'expires_at'=>$now+120];
        $saved['result']='Queued; waiting for shunt confirmation';
    }
    $saved['pending']=$pending;
    $view=$saved;$view['server_time']=$now;
    if ($device) $view=['command'=>$pending,'server_time'=>$now];
    return [200,$saved,$view];
}
