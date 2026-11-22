<?php
declare(strict_types=1);
function paw_log_date(int $epoch):string {return (new DateTimeImmutable('@'.$epoch))->setTimezone(new DateTimeZone('America/Detroit'))->format('Y-m-d');}
function paw_log_oldest(int $now):string {return (new DateTimeImmutable('@'.$now))->setTimezone(new DateTimeZone('America/Detroit'))->modify('-6 days')->format('Y-m-d');}
function paw_log_valid_date(string $date):bool {$d=DateTimeImmutable::createFromFormat('!Y-m-d',$date,new DateTimeZone('America/Detroit'));return $d!==false&&$d->format('Y-m-d')===$date;}
function paw_log_validate(mixed $input,string $device,int $now):array {
    if(!is_array($input)||array_diff(array_keys($input),['errors','archive']))throw new InvalidArgumentException('Invalid logs');
    $out=['days'=>[],'rows'=>[]];$oldest=paw_log_oldest($now);$today=paw_log_date($now);
    if(isset($input['errors'])){
        $e=$input['errors'];
        if(!is_array($e)||!is_bool($e['clock']??null)||!is_bool($e['rollback']??null)||!is_array($e['days']??null)||!array_is_list($e['days'])||count($e['days'])>2)throw new InvalidArgumentException('Invalid error snapshot');
        $out['clock']=$e['clock'];$out['rollback']=$e['rollback'];$seen=[];
        foreach($e['days']as$d){
            if(!is_array($d)||!is_int($d['date']??null)||strlen((string)$d['date'])!==8)throw new InvalidArgumentException();
            $date=substr((string)$d['date'],0,4).'-'.substr((string)$d['date'],4,2).'-'.substr((string)$d['date'],6,2);
            if(!paw_log_valid_date($date)||$date>$today||isset($seen[$date])||!is_int($d['omitted']??null)||$d['omitted']<0||$d['omitted']>4294967295||
               !is_array($d['entries']??null)||!array_is_list($d['entries'])||count($d['entries'])>32)throw new InvalidArgumentException('Invalid error day');
            $seen[$date]=true;
            foreach($d['entries']as$row){
                if(!is_array($row)||!array_is_list($row)||count($row)!==3||!is_int($row[0])||!is_int($row[1])||!is_int($row[2])||
                   $row[0]<1||$row[0]>$now+300||paw_log_date($row[0])!==$date||$row[1]<0||$row[1]>65535||$row[2]<0||$row[2]>65535)throw new InvalidArgumentException('Invalid event');
            }
            if($date>=$oldest)$out['days'][]=['date'=>$date,'omitted'=>$d['omitted'],'entries'=>$d['entries']];
        }
    }
    $a=$input['archive']??[];
    if($a!==[]){
        if($device!=='tracer'||!is_array($a)||count($a)!==2||!is_int($a['hour']??null)||$a['hour']<0||
           !is_string($a['hex']??null)||!preg_match('/^[a-f0-9]{3864}$/D',$a['hex']))throw new InvalidArgumentException('Invalid archive');
        $bytes=hex2bin($a['hex']);$head=unpack('Vmagic/Vhour',substr($bytes,0,8));
        if($head['magic']!==0x50545231||$head['hour']!==$a['hour'])throw new InvalidArgumentException('Archive header');
        $hash=2166136261;
        for($i=0;$i<1928;++$i)$hash=(($hash^ord($bytes[$i]))*16777619)&0xffffffff;
        if($hash!==unpack('V',substr($bytes,1928,4))[1])throw new InvalidArgumentException('Archive checksum');
        $low=[0,0,0,0,-2000,-100,-100];$high=[1500,2000,100000,1000,2000,150,150];
        for($i=0;$i<60;++$i){
            $offset=8+$i*32;$epoch=unpack('V',substr($bytes,$offset,4))[1];if(!$epoch)continue;
            if(intdiv($epoch,3600)!==$a['hour']||intdiv($epoch,60)%60!==$i||$epoch>$now+300)throw new InvalidArgumentException('Archive timestamp');
            $row=[$epoch];$values=array_values(unpack('g7',substr($bytes,$offset+4,28)));
            foreach($values as$j=>$v){
                if(is_nan($v)){$row[]=null;continue;}
                if(!is_finite($v)||$v<$low[$j]||$v>$high[$j])throw new InvalidArgumentException('Archive reading');
                $row[]=$v;
            }
            $date=paw_log_date($epoch);if($date>=$oldest&&$date<=$today)$out['rows'][]=$row;
        }
    }
    return $out;
}
function paw_log_record(string $device,array $logs,int $now):void {
    $metaPath=PAW_PRIVATE.'/unit-logs-'.$device.'-latest.json';$meta=paw_read($metaPath);
    $meta['received_at']=$now;
    if(isset($logs['clock'])){$meta['clock']=$logs['clock'];$meta['rollback']=$logs['rollback'];$meta['errors_received_at']=$now;}
    foreach($logs['days']as$day){$day['received_at']=$now;paw_write(PAW_PRIVATE.'/unit-logs-'.$device.'-errors-'.$day['date'].'.json',$day);}
    $groups=[];foreach($logs['rows']as$row)$groups[paw_log_date($row[0])][]=$row;
    foreach($groups as$date=>$rows){
        $path=PAW_PRIVATE.'/unit-logs-tracer-readings-'.$date.'.json';
        $day=paw_read($path,['date'=>$date,'rows'=>[]]);$indexed=[];
        foreach($day['rows']as$row)$indexed[intdiv($row[0],60)]=$row;
        foreach($rows as$row){$minute=intdiv($row[0],60);if(!isset($indexed[$minute])||$indexed[$minute][0]<=$row[0])$indexed[$minute]=$row;}
        ksort($indexed);$day['rows']=array_values($indexed);$day['received_at']=$now;
        if(count($day['rows'])>1560)throw new InvalidArgumentException('Too many minute samples');
        paw_write($path,$day);$meta['archive_received_at']=$now;
    }
    paw_write($metaPath,$meta);
    foreach(['errors','readings']as$kind)foreach(glob(PAW_PRIVATE.'/unit-logs-'.$device.'-'.$kind.'-????-??-??.json')?:[]as$file)
        if(substr(basename($file),-15,10)<paw_log_oldest($now))unlink($file);
}
function paw_log_view(string $device,string $date,int $now):array {
    $meta=paw_read(PAW_PRIVATE.'/unit-logs-'.$device.'-latest.json');
    $errors=paw_read(PAW_PRIVATE.'/unit-logs-'.$device.'-errors-'.$date.'.json');
    $readings=$device==='tracer'?paw_read(PAW_PRIVATE.'/unit-logs-tracer-readings-'.$date.'.json'):[];
    return ['device'=>$device,'date'=>$date,'server_time'=>$now,'timezone'=>'America/Detroit',
        'received_at'=>$meta['received_at']??null,'errors_received_at'=>$meta['errors_received_at']??null,
        'archive_received_at'=>$meta['archive_received_at']??null,'clock'=>$meta['clock']??null,'rollback'=>$meta['rollback']??false,
        'errors_available'=>isset($errors['date']),'errors'=>$errors['entries']??[],'omitted'=>$errors['omitted']??0,
        'readings_available'=>isset($readings['date']),'readings'=>$readings['rows']??[]];
}
