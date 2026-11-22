const commonHeader=require('node:fs').readFileSync(require('node:path').join(__dirname,'../pawpower_common/web_assets.h'),'utf8');
const commonJS=commonHeader.split('R"PAWCOMMONJS(')[1].split(')PAWCOMMONJS"')[0];
require('node:vm').runInThisContext(commonJS);
const assert=require('node:assert/strict');
const {parseSnapshot}=require('../tracer_shared/dashboard.js');
const good={mode:'Poll - no dongle',values:[94.23,1.15,108.95,52.13,2.22,25,26.15,80,2.22],ages:Array(9).fill(2),matched:42,orphan:0,exceptions:0};
assert.equal(parseSnapshot(JSON.stringify(good)).values[2],108.95);
assert.throws(()=>parseSnapshot({...good,values:[1]}));
assert.throws(()=>parseSnapshot({...good,mode:'wrong'}));
assert.throws(()=>parseSnapshot({...good,values:Array(9).fill('bad')}));
assert.equal(parseSnapshot({...good,values:Array(9).fill(null)}).values[0],null);
console.log('Dashboard payload checks passed.');
const vm=require('node:vm'),fs=require('node:fs');
async function uiTest(){
 const nodes=new Map();const node=id=>nodes.get(id)||nodes.set(id,{textContent:'',value:'',style:{},disabled:false,handlers:{},getContext(){return null},replaceChildren(){},appendChild(){},setAttribute(k,v){this[k]=v},classList:{toggle(){},add(){},remove(){}},addEventListener(k,v){this.handlers[k]=v}}).get(id);
 const element=()=>({style:{},children:[],appendChild(c){this.children.push(c);this.firstChild=this.children[0];},replaceChildren(){this.children=[];},querySelector(sel){return node(sel.replace('#',''));},addEventListener(){},insertBefore(){}});
 const body={classList:{add(){},remove(){}},set innerHTML(s){for(const m of s.matchAll(/id="([^"]+)"/g))node(m[1]);}};
 let fail=false,timers=[],calls=[];
 const context={document:{readyState:'complete',head:{appendChild(){}},body,createElement:element,querySelector:sel=>sel.startsWith('meta')?null:element(),getElementById:node,addEventListener(){}},window:{addEventListener(){}},cancelAnimationFrame(){},location:{origin:'http://paw.test'},performance:{now:()=>100},setInterval:fn=>timers.push(fn),setTimeout:()=>0,clearTimeout(){},AbortController,confirm:()=>false,fetch:async(url,opts)=>{calls.push([url,opts]);if(fail)throw Error('offline');return {ok:true,json:async()=>url.endsWith('/paw/energy-history')?{clock:true,days:Array.from({length:31},(_,i)=>({date:new Date(Date.UTC(2026,10,21-i)).toISOString().slice(0,10),in:1.25+i,out:0,hours:23.99,partial:true,max_w:1000,max_pv_a:12,max_charge_a:20,max_discharge_a:0,max_temp_c:30}))}:{value:JSON.stringify(good)}};}};
 vm.runInNewContext(commonJS,context);
 // Equipment preferences have their own focused DOM/contract tests.
 context.PawPowerCommon.mountEquipmentPreferences=()=>{};
 context.PawPowerCommon.mountErrorLog=()=>{};
 context.PawPowerCommon.mountTracerArchive=()=>{};
 vm.runInNewContext(fs.readFileSync(require.resolve('../tracer_shared/dashboard.js'),'utf8').replace(/import\('\/paw\/common\.js\?v=\d+'\)/,'Promise.resolve()'),context);
 await new Promise(r=>setImmediate(r));assert.equal(node('solar').textContent,'109');assert.equal(node('bat-v').textContent,'52.13 V');assert.match(node('raw-soc').textContent,/80%/);assert.equal(node('daily-kwh').textContent,'1.25');assert.equal(node('bat-t').textContent,'77.0 °F');
 node('mode').value='Poll - no dongle';await node('apply').handlers.click();assert.equal(calls.filter(x=>x[1].method==='POST').length,0);
 fail=true;await timers[2]();assert.equal(node('network').textContent,'Connection lost · retrying');fail=false;await timers[2]();assert.equal(node('network').textContent,'● ESP32 connected');
 console.log('Dashboard DOM, cancelled mode change and reconnect checks passed.');
}
uiTest().catch(e=>{console.error(e);process.exitCode=1;});
const {graphPath}=require('../tracer_shared/dashboard.js');
const g=graphPath([{t:1000,v:10},{t:7000,v:20},{t:40000,v:30}],0,60000);
assert.equal((g.path.match(/M/g)||[]).length,2);assert.equal((g.path.match(/L/g)||[]).length,1);assert.equal(g.count,3);
assert.equal(graphPath([{t:1000,v:10}],2000,60000).count,0);
assert.equal(graphPath([],0,60000).path,'');console.log('Graph gap/window checks passed.');
