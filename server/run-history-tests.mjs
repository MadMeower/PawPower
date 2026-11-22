import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PHP}=require('./test-tools/node_modules/@php-wasm/universal');
const {loadNodeRuntime}=require('./test-tools/node_modules/@php-wasm/node');
const php=new PHP(await loadNodeRuntime('8.4',{emscriptenOptions:{processId:2}}));
try {
 const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
 const tests=read('./history.test.php').replace(/^<\?php\s*/,'');
 const prepare=path=>read(path).replace(/^<\?php\s*/,'').replace('declare(strict_types=1);','')
   .replaceAll("require PAW_PRIVATE.'/backend.php';",'').replaceAll("require PAW_PRIVATE.'/history.php';",'')
   .replaceAll("require PAW_PRIVATE . '/backend.php';",'')
   .replaceAll('time()',"$GLOBALS['now']")
   .replace(/file_get_contents\('php:\/\/input',false,null,0,\d+\)/g,"$GLOBALS['request_body']")
   .replace('catch(Throwable $e){','catch(Throwable $e){if($e instanceof TestResponse)throw $e;')
   .replace('catch (Throwable $error) {','catch (Throwable $error) {if($error instanceof TestResponse)throw $error;');
 const history=Buffer.from(prepare('./public/history.php')).toString('base64');
 const push=Buffer.from(prepare('./public/device-test.php')).toString('base64');
 const endpointTests=read('./companion-endpoints.test.php').replace(/^<\?php\s*/,'');
 const code=read('./private/history.php')+'\nob_start();\n'+tests+
   "\n$historyEndpoint=base64_decode('"+history+"');$testEndpoint=base64_decode('"+push+"');\n"+endpointTests;
 const result=await php.runStream({code});
 const out=await result.stdoutText,err=await result.stderrText;
 if(err)console.error(err);console.log(out);
 if(!out.includes('History tests passed:')||!out.includes('Companion endpoint tests passed:'))process.exitCode=1;
}finally{php.exit();}
