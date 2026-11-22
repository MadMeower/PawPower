import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PHP}=require('./test-tools/node_modules/@php-wasm/universal');
const {loadNodeRuntime}=require('./test-tools/node_modules/@php-wasm/node');
const php=new PHP(await loadNodeRuntime('8.4',{emscriptenOptions:{processId:9}}));
try{
 const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replace(/^<\?php\s*/,'').replace('declare(strict_types=1);','');
 const endpoint=read('./public/widget-subscription.php')
  .replace(/require PAW_PRIVATE\.'\/(?:backend|widget-push)\.php';/g,'')
  .replace('catch(Throwable $error){','catch(Throwable $error){if($error instanceof WidgetResponse)throw $error;')
  .replaceAll('time()',"$GLOBALS['now']");
 const code='<?php '+read('./private/widget-push.php')+
  "\n$GLOBALS['endpoint']=base64_decode('"+Buffer.from(endpoint).toString('base64')+"');\n"+read('./widget-push.test.php');
 const result=await php.runStream({code});const out=await result.stdoutText,err=await result.stderrText;
 console.log(out);if(err)console.error(err);if(!out.includes('Widget push tests passed:'))process.exitCode=1;
}finally{php.exit();}
