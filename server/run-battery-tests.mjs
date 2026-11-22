import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PHP}=require('./test-tools/node_modules/@php-wasm/universal');
const {loadNodeRuntime}=require('./test-tools/node_modules/@php-wasm/node');
const php=new PHP(await loadNodeRuntime('8.4',{emscriptenOptions:{processId:1}}));
try{
 const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replace(/^<\?php\s*/,'').replace('declare(strict_types=1);','');
 const endpoint=read('./public/battery-settings.php')
   .replace(/require PAW_PRIVATE\.'\/(?:backend|battery-settings)\.php';/g,'')
   .replace(/file_get_contents\('php:\/\/input',false,null,0,4097\)/g,"$GLOBALS['request_body']")
   .replaceAll('time()',"$GLOBALS['now']")
   .replace('catch(Throwable $e){','catch(Throwable $e){if($e instanceof BatteryResponse)throw $e;');
 const result=await php.run({code:'<?php ob_start(); '+read('./private/battery-settings.php')+'\n'+read('./battery-settings.test.php')+
   "\n$GLOBALS['endpoint']=base64_decode('"+Buffer.from(endpoint).toString('base64')+"');\n"+read('./battery-endpoints.test.php')});
 console.log(result.text);if(result.errors)console.error(result.errors);
 if(result.errors || !result.text.includes('Battery settings state-machine tests passed') || !result.text.includes('Battery settings endpoint auth and conflict tests passed'))process.exitCode=1;
}finally{php.exit()}
