<?php
declare(strict_types=1);
// Run once per minute with PHP CLI. This file stays OUTSIDE the document root.
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
if(!defined('PAW_PRIVATE'))define('PAW_PRIVATE',__DIR__);
require PAW_PRIVATE.'/backend.php';
require PAW_PRIVATE.'/widget-push.php';
$handle=fopen(PAW_PRIVATE.'/widget-dispatch.lock','c');
if($handle===false){fwrite(STDERR,"Widget dispatch storage unavailable\n");exit(1);}
chmod(PAW_PRIVATE.'/widget-dispatch.lock',0600);
if(!flock($handle,LOCK_EX|LOCK_NB)){fclose($handle);exit;}
try{
    $result=paw_widget_publish(paw_config(),time());
    // Counts only: never print tokens, account information or readings.
    echo json_encode($result,JSON_THROW_ON_ERROR)."\n";
}catch(Throwable $error){
    error_log('PawPower widget dispatch: '.get_class($error));exit(1);
}finally{flock($handle,LOCK_UN);fclose($handle);}
