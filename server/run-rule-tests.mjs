import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PHP}=require('./test-tools/node_modules/@php-wasm/universal');
const {loadNodeRuntime}=require('./test-tools/node_modules/@php-wasm/node');
const php=new PHP(await loadNodeRuntime('8.4',{emscriptenOptions:{processId:1}}));
try {
  const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replace(/^<\?php\s*/,'').replace('declare(strict_types=1);','');
  const prepare=p=>read(p)
    .replace(/require PAW_PRIVATE\s*\.\s*'\/(?:backend|notification-rules|notification-settings|equipment-alerts)\.php';/g,'')
    .replace(/file_get_contents\('php:\/\/input',\s*false,\s*null,\s*0,\s*\d+\)/g,"$GLOBALS['request_body']")
    .replaceAll('time()',"$GLOBALS['now']")
    .replace('catch (Throwable $error) {','catch (Throwable $error) { if ($error instanceof TestResponse) throw $error;')
    .replace('catch(Throwable $e){','catch(Throwable $e){if($e instanceof TestResponse)throw $e;');
  const endpoint=(name,p)=>"$"+name+"=base64_decode('"+Buffer.from(prepare(p)).toString('base64')+"');";
  const code='<?php '+read('./private/notification-rules.php')+'\n'+read('./private/equipment-alerts.php')+
    '\nob_start();\n'+read('./notification-rules.test.php')+'\n'+read('./private/notification-settings.php')+
    '\n'+endpoint('prefEndpoint','./public/notification-preferences.php')+
    endpoint('monitorEndpoint','./public/device-monitor.php')+
    endpoint('equipmentEndpoint','./public/equipment-preferences.php')+
    '\n'+read('./notification-endpoints.test.php')+'\n'+read('./equipment-alerts.test.php');
  const result=await php.runStream({code});
  const stdout=await result.stdoutText,stderr=await result.stderrText;
  console.log(stdout);if(stderr)console.error(stderr);
  for(const marker of ['Notification rule tests passed','Notification endpoint tests passed','Equipment alert tests passed','Equipment endpoint tests passed'])
    if(!stdout.includes(marker))process.exitCode=1;
}finally{php.exit();}
