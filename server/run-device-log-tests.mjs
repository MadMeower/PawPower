import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PHP}=require('./test-tools/node_modules/@php-wasm/universal');
const {loadNodeRuntime}=require('./test-tools/node_modules/@php-wasm/node');
const php=new PHP(await loadNodeRuntime('8.4',{emscriptenOptions:{processId:7}}));
try{
 const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replace(/^<\?php\s*/,'').replace('declare(strict_types=1);','');
 const prepare=p=>read(p).replace(/require(?:_once)? PAW_PRIVATE\s*\.\s*'\/(?:backend|history|device-logs)\.php';/g,'')
  .replaceAll('time()',"$GLOBALS['now']")
  .replace(/file_get_contents\('php:\/\/input',false,null,0,\d+\)/g,"$GLOBALS['request_body']")
  .replace('catch(Throwable $e){','catch(Throwable $e){if($e instanceof LogResponse)throw $e;');
 const code='<?php '+read('./private/history.php')+'\n'+read('./private/device-logs.php')+
  "\n$logEndpoint=base64_decode('"+Buffer.from(prepare('./public/device-logs.php')).toString('base64')+
  "');$historyEndpoint=base64_decode('"+Buffer.from(prepare('./public/history.php')).toString('base64')+"');\n"+
  read('./device-logs.test.php');
 const result=await php.runStream({code});const out=await result.stdoutText,err=await result.stderrText;
 console.log(out);if(err)console.error(err);if(!out.includes('Device log tests passed'))process.exitCode=1;
}finally{php.exit();}
