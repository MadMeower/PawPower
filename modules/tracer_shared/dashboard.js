(() => {
'use strict';
const names=['Solar voltage','Solar current','Solar power','Battery voltage','Battery current','Battery temperature','Controller temperature','Controller SOC','Current low word'];
function parseSnapshot(payload){
 const d=typeof payload==='string'?JSON.parse(payload):payload;
 if(!d||!Array.isArray(d.values)||!Array.isArray(d.ages)||d.values.length!==9||d.ages.length!==9)throw Error('Invalid dashboard data');
 if(!['Poll - no dongle','Listen - Solar Guardian'].includes(d.mode))throw Error('Unknown connection mode');
 for(const n of [...d.values,...d.ages])if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)))throw Error('Invalid reading');
 if(d.charge_control!==undefined){
  const c=d.charge_control;
  if(!c || !Number.isInteger(c.sequence)||c.sequence<0 || !Number.isInteger(c.state)||c.state<0||c.state>7 ||
   (c.requested!==null && typeof c.requested!=='boolean') ||
   !Number.isInteger(c.exception)||c.exception<0||c.exception>255 ||
   (c.status!==null && (!Number.isInteger(c.status)||c.status<0||c.status>65535)) ||
   (c.age!==null && (!Number.isFinite(c.age)||c.age<0)))throw Error('Invalid charging-control status');
 }
 return d;
}
function chargeControlText(control, elapsed=0){
 if(!control)return 'Update Tracer firmware to enable charging controls.';
 const name=control.requested?'On':'Off';
 const messages=['No manual charging command sent.','Charging '+name+' command queued.',
  'Waiting for controller acknowledgement.','Controller acknowledged charging '+name+'.',
  'Controller rejected the command (Modbus exception '+control.exception+').',
  'No controller acknowledgement. Charging state is unknown.',
  'Listen mode cannot send commands. Disconnect the dongle and select Poll - no dongle.',
  'Command cancelled. Charging state is unknown.'];
 let text=messages[control.state]||'Unknown command status.';
 if(control.status!==null && control.age!==null){
  const stages=['Not charging','Float','Boost','Equalization'];
  text+=' Reported stage: '+stages[(control.status>>2)&3]+
    (control.age+elapsed>20?' (stale).':'.');
 }
 return text;
}
if(typeof module!=='undefined'&&module.exports){module.exports={parseSnapshot,newPongMatch,stepPong,graphPath,chargeControlText};return;}
  function newPongMatch(...args){return globalThis.PawPowerCommon.newPongMatch(...args);}
  function stepPong(...args){return globalThis.PawPowerCommon.stepPong(...args);}
  function createPongAudio(...args){return globalThis.PawPowerCommon.createPongAudio(...args);}
  function mountPong(...args){return globalThis.PawPowerCommon.mountPong(...args);}
function graphPath(points,start,end,width=800,height=220,gap=20000){
 const shown=points.filter(p=>p.t>=start&&p.t<=end&&Number.isFinite(p.v));
 const max=Math.max(1,...shown.map(p=>p.v)),min=Math.min(0,...shown.map(p=>p.v));
 let prev=null,path='';const dots=[];
 for(const p of shown){const x=50+(p.t-start)/(end-start)*(width-65),y=12+(max-p.v)/(max-min)*(height-42);path+=(prev&&p.t-prev.t<=gap?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)+' ';dots.push([x,y]);prev=p;}
 return {path,dots,min,max,count:shown.length};
}
function start(){
 document.title='Paw Power | Tracer';
 let viewport=document.querySelector('meta[name="viewport"]');if(!viewport){viewport=document.createElement('meta');viewport.name='viewport';document.head.appendChild(viewport);}viewport.content='width=device-width, initial-scale=1';
 const css=document.createElement('style');css.textContent=`
 :root{color-scheme:dark;font:15px system-ui,sans-serif;background:#0c141e;color:#cfd9e3;--green:#61e4aa;--muted:#92aabd;--gold:#ffd23f}
 .history{background:#142230;border:1px solid #263e50;border-radius:20px;padding:20px;margin-top:16px}.note{color:var(--muted);font-size:13px}.settings-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}th{font-size:12px;color:var(--muted);padding:12px 4px} *{box-sizing:border-box}body{margin:0}main{max-width:1030px;margin:auto;padding:22px}header{display:flex;align-items:center;gap:14px;margin-bottom:20px}header svg{width:64px;height:64px;flex-shrink:0}h1{font-size:25px;margin:0}p{line-height:1.5}small,.muted{color:var(--muted)}header p{margin:3px 0}#network{margin-left:auto;font-size:13px;color:var(--gold)}.hero{display:grid;grid-template-columns:1.1fr 1fr;gap:16px}.card{background:#142230;border:1px solid #263e50;border-radius:20px;padding:23px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.13em;color:var(--muted)}.big{font-size:65px;line-height:1.2;color:var(--green);font-weight:750;margin:12px 0}.unit{font-size:22px;color:var(--muted);font-weight:400}.row{display:flex;justify-content:space-between;gap:15px;align-items:center}.subreadings{display:flex;gap:35px;margin-top:22px}.subreadings strong{display:block;font-size:23px;margin-top:5px}.soc{display:flex;gap:24px;align-items:center}.ring{width:165px;transform:rotate(-90deg);flex-shrink:0}.ring circle{fill:none;stroke-width:10}.soc strong{font-size:37px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:16px}.value{font-size:31px;font-weight:650;margin:10px 0 4px}.age{font-size:12px;color:var(--muted)}.stale .value,.stale .big{color:#ffbc6b}.stale{border-color:#876642}.controls{margin-top:16px}select,button{font:inherit;color:#e7f0f7;background:#20394e;border:1px solid #46687e;border-radius:10px;padding:11px 14px}button{cursor:pointer;background:#195346}button:disabled{opacity:.5;cursor:wait}select{max-width:100%}.controls .row{flex-wrap:wrap}.hint{font-size:13px;color:var(--muted);margin-bottom:0}#feedback{color:var(--gold);min-height:20px;margin-top:9px}.offline main .card:not(.controls){opacity:.6}details{margin-top:15px;font-size:13px;color:var(--muted)}summary{cursor:pointer}footer{font-size:12px;color:var(--muted);margin-top:18px;text-align:center}@media(max-width:650px){main{padding:14px}.hero{grid-template-columns:1fr}.grid{grid-template-columns:repeat(2,1fr)}header{flex-wrap:wrap}#network{margin-left:0}.big{font-size:54px}.soc{justify-content:center}.card{padding:18px}}@media(max-width:380px){.grid{grid-template-columns:1fr}.ring{width:130px}}
 `;document.head.appendChild(css);
 document.body.innerHTML=`<main><header><svg viewBox="0 0 80 80" aria-label="Paw Power logo" role="img"><g fill="#61e4aa"><ellipse cx="16" cy="28" rx="9" ry="12"/><ellipse cx="32" cy="15" rx="9" ry="12"/><ellipse cx="52" cy="15" rx="9" ry="12"/><ellipse cx="67" cy="29" rx="9" ry="12"/><path d="M19 56C19 43 30 34 41 34S64 46 64 58C64 76 19 77 19 56Z"/></g><path d="M44 31 30 51H41L36 68 57 43H44L50 31Z" fill="#ffd23f"/></svg><div><h1>Paw Power Tracer</h1><p class="muted">Locally grown · Free range electrons</p></div><div id="network" role="status">Connecting…</div></header>
 <section class="hero"><article class="card" id="solar-card"><div class="eyebrow">Solar harvest · right now</div><div class="big"><span id="solar">—</span> <span class="unit">W</span></div><div id="solar-note" class="muted">Waiting for controller data</div><div class="subreadings"><div><small>Panel voltage</small><strong id="pv-v">—</strong><div id="age-0" class="age"></div></div><div><small>Panel current</small><strong id="pv-a">—</strong><div id="age-1" class="age"></div></div></div></article>
 <article class="card" id="daily-card"><div class="eyebrow">Today’s solar harvest</div><div class="big"><span id="daily-kwh">—</span> <span class="unit">kWh</span></div><div id="daily-coverage" class="muted">Waiting for energy history</div><p class="hint">Solar input measured by Paw Power. Saved on this ESP32.</p></article></section>
 <section class="grid"><article class="card" id="card-3"><div class="eyebrow">Battery voltage</div><div class="value" id="bat-v">—</div><div id="age-3" class="age"></div></article><article class="card" id="card-4"><div class="eyebrow">Battery current</div><div class="value" id="bat-a">—</div><div id="age-4" class="age"></div><small id="current-note"></small></article><article class="card" id="power-card"><div class="eyebrow">Battery power · calculated</div><div class="value" id="bat-w">—</div><div class="age">Voltage × current · separate samples</div></article><article class="card" id="card-5"><div class="eyebrow">Battery temperature</div><div class="value" id="bat-t">—</div><div id="age-5" class="age"></div><small>May report 77°F without a probe</small></article><article class="card" id="card-6"><div class="eyebrow">Controller temperature</div><div class="value" id="ctrl-t">—</div><div id="age-6" class="age"></div></article><article class="card"><div class="eyebrow">Communication</div><div class="value" id="replies">—</div><small>Matched replies since reboot</small><div class="age" id="mode-label"></div></article></section>
 <details class="card" style="margin-top:16px" open><summary style="cursor:pointer;font-weight:650">Live graphs</summary><div class="row"><div><p class="hint">This browser session · up to two hours · gaps stay gaps</p></div><select id="graph-field" aria-label="Graph reading"><option value="2">Solar power · W</option><option value="3">Battery voltage · V</option><option value="4">Battery current · A</option><option value="6">Controller temperature · °F</option></select></div><div class="settings-actions"><button id="graph-in">Zoom +</button><button id="graph-out">Zoom −</button><button id="graph-live">Live · full range</button></div><div id="graph" style="touch-action:none;cursor:grab" role="img" aria-label="Live readings graph"></div><p id="graph-range" class="hint"></p><p class="hint">Scroll to zoom · drag to pan. Detailed points are kept in this browser while the page is open; daily totals and peaks are saved on the ESP32.</p></details><section class="card" style="margin-top:16px"><div class="row"><div><div class="eyebrow">Solar history · last 31 days</div><p class="hint">Generated kWh · recorded coverage</p></div><button id="export-history">Download CSV</button></div><div id="history-note" class="hint">Loading…</div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;text-align:right"><thead><tr><th style="text-align:left">Date</th><th>Generated kWh</th><th>Peak solar W</th><th>Peak solar A</th><th>Peak +A</th><th>Peak −A</th><th>Max °F</th><th>Coverage</th></tr></thead><tbody id="history-rows"></tbody></table></div></section><section class="card controls"><div class="row"><div><div class="eyebrow">Connection mode</div><p class="hint">Choose how Paw Power reads the Tracer.</p></div><div><select id="mode" aria-label="Connection mode"><option>Listen - Solar Guardian</option><option>Poll - no dongle</option></select> <button id="apply">Apply</button></div></div><p class="hint">Unplug the Wi-Fi dongle and other polling devices before selecting Poll. Your selection is saved and restored after reboot. Disconnect the dongle before using Poll mode.</p><div id="feedback" role="status"></div><details><summary>Reading details</summary><p id="diagnostics"></p><p>Updates follow the current mode: direct polling takes about seven seconds per cycle; listening follows the dongle’s schedule. Amber cards mark readings older than 20 seconds when polling, or 120 seconds when listening. Last readings remain visible with their age.</p><p id="raw-soc">Controller SOC: waiting. Not used for bank capacity or charge control.</p><p>Energy history integrates fresh solar samples, not battery discharge or total household consumption. Missing time is not filled in.</p></details></section><footer>Paw Power · Tracer10415AN · Local monitoring</footer></main>`;
 const $=id=>document.getElementById(id),fmt=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'—';
 let data=null,received=0,busy=false,editing=false,applying=false;
 const chargePanel=document.createElement('section');chargePanel.className='card controls';
 chargePanel.innerHTML='<div class="eyebrow">Solar charging</div><p class="hint">Manual control of the controller charger. Its normal battery protections remain active. Off does not electrically isolate the equipment.</p><div class="settings-actions"><button id="tracer-charge-on" disabled>Charging On</button><button id="tracer-charge-off" disabled>Charging Off</button></div><p id="tracer-charge-feedback" role="status">Checking charging-control support…</p>';
 document.querySelector('main').insertBefore(chargePanel,document.querySelector('main > footer'));
 let chargeSending=false,chargePending=null,chargeError='',chargeErrorSequence=-1;
 function renderChargeControl(){
  const c=data?.charge_control,elapsed=(performance.now()-received)/1000;
  if(c && chargeError && c.sequence!==chargeErrorSequence)chargeError='';
  if(chargePending && c && c.sequence!==chargePending.sequence && c.state!==1 && c.state!==2)chargePending=null;
  if(chargePending && performance.now()>chargePending.until){
   chargeError='No controller result received. Check the reported stage before retrying.';
   chargeErrorSequence=c?.sequence??-1;chargePending=null;
  }
  const enabled=!!c && data.mode==='Poll - no dongle' && elapsed<15 &&
    !chargeSending && !chargePending && c.state!==1 && c.state!==2;
  $('tracer-charge-on').disabled=$('tracer-charge-off').disabled=!enabled;
  $('tracer-charge-feedback').textContent=chargeError || (chargeSending?'Sending command…':
    chargePending?'Waiting for controller result…':chargeControlText(c,elapsed));
 }
 async function sendCharge(enabled){
  if($('tracer-charge-'+(enabled?'on':'off')).disabled)return;
  chargeSending=true;chargeError='';renderChargeControl();
  const sequence=data.charge_control.sequence;
  try{
   const response=await fetch('/button/'+encodeURIComponent(enabled?'Tracer Charging On':'Tracer Charging Off')+'/press',
    {method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
   if(!response.ok)throw Error('Device request failed: HTTP '+response.status);
   chargePending={sequence,until:performance.now()+10000};
  }catch(error){chargeError=error.message;chargeErrorSequence=sequence;}
  finally{chargeSending=false;renderChargeControl();read();}
 }
 $('tracer-charge-on').onclick=()=>sendCharge(true);
 $('tracer-charge-off').onclick=()=>sendCharge(false);
 const traces={2:[],3:[],4:[],6:[]};let graphView=null;
 const base=location.origin;
 function render(){if(!data)return;const v=data.values,elapsed=(performance.now()-received)/1000;
 const age=i=>data.ages[i]===null?null:data.ages[i]+elapsed;
 const limit=data.mode==='Poll - no dongle'?20:120;
 const fresh=i=>v[i]!==null&&age(i)!==null&&age(i)<=limit;
 for(let i=0;i<7;i++){const el=$('age-'+i);if(el)el.textContent=age(i)===null?'Not received yet':`${Math.floor(age(i))}s ago${fresh(i)?'':' · stale'}`;const card=$('card-'+i);if(card)card.classList.toggle('stale',!fresh(i));}
 $('solar').textContent=fmt(v[2],0);$('solar-note').textContent=age(2)===null?'Waiting for solar power':`${Math.floor(age(2))}s ago${fresh(2)?'':' · stale reading'}`;
 $('solar-card').classList.toggle('stale',![0,1,2].every(fresh));
 $('pv-v').textContent=fmt(v[0])+' V';$('pv-a').textContent=fmt(v[1])+' A';
 $('bat-v').textContent=fmt(v[3])+' V';$('bat-a').textContent=fmt(v[4])+' A';
 $('current-note').textContent=v[4]===null?'Waiting for complete current reading':v[4]>0?'Charging':v[4]<0?'Net battery discharge':'No net current';
 const power=fresh(3)&&fresh(4)?v[3]*v[4]:null;$('bat-w').textContent=fmt(power,0)+' W';$('power-card').classList.toggle('stale',power===null);
 for(const [id,i] of [['bat-t',5],['ctrl-t',6]])$(id).textContent=v[i]===null?'—':fmt(v[i]*1.8+32,1)+' °F';
 $('raw-soc').textContent='Controller SOC: '+fmt(v[7],0)+'% (unreliable for this bank; diagnostic only).';
 $('replies').textContent=String(data.matched);$('mode-label').textContent=data.mode;
 $('diagnostics').textContent=`Unmatched replies: ${data.orphan} · Controller exceptions: ${data.exceptions} · Low current word: ${fmt(v[8])} A (diagnostic only; sign is unverified).`;
 if(!editing&&!applying)$('mode').value=data.mode;
 renderChargeControl();
 }
 let history=null,historyBusy=false;
 function renderHistory(h){
  const rows=$('history-rows');rows.replaceChildren();
  $('history-note').textContent=h.clock?'Partial means startup, missing samples or interrupted coverage.':'Waiting for the ESP32 clock to synchronize.';
  const today=h.days[0];$('daily-kwh').textContent=today&&!today.missing?fmt(today.in,2):'—';
  $('daily-coverage').textContent=today&&!today.missing?`${today.partial?'Partial · ':''}${fmt(today.hours,1)}h recorded`:'No recorded solar samples today';
  for(const d of h.days){if(d.missing)continue;const tr=document.createElement('tr');for(const text of [d.date,fmt(d.in,2),fmt(d.max_w,0),fmt(d.max_pv_a),fmt(d.max_charge_a),d.max_discharge_a==null?'—':'−'+fmt(d.max_discharge_a),d.max_temp_c==null?'—':fmt(d.max_temp_c*1.8+32,1),`${d.partial?'Partial · ':''}${fmt(d.hours,1)}h`]){const td=document.createElement('td');td.textContent=text;td.style.padding='10px 4px';td.style.borderBottom='1px solid #263e50';tr.appendChild(td);}tr.firstChild.style.textAlign='left';rows.appendChild(tr);}
 }
 async function readHistory(){if(historyBusy||document.hidden)return;historyBusy=true;const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);try{
  const r=await fetch(base+'/text_sensor/'+encodeURIComponent('Solar Energy History'),{cache:'no-store',credentials:'same-origin',signal:c.signal});if(!r.ok)throw Error('History unavailable');const e=await r.json();const h=JSON.parse(e.value??e.state);
  if(!h||typeof h.clock!=='boolean'||!Array.isArray(h.days)||h.days.length>31)throw Error('Invalid history');
  for(const d of h.days){if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||(!d.missing&&(!Number.isFinite(d.in)||!Number.isFinite(d.hours))))throw Error('Invalid day');}
  history=h;renderHistory(h);
 }catch(e){$('history-note').textContent='History unavailable · retrying. Previously loaded totals may be old.';}finally{clearTimeout(t);historyBusy=false;}}
 $('export-history').addEventListener('click',()=>{if(!history){$('history-note').textContent='No history loaded yet.';return;}let csv='Date,Generated kWh,Peak solar W,Peak solar A,Peak charge A,Peak discharge magnitude A,Max controller C,Coverage hours,Partial,Missing\r\n';for(const d of history.days)csv += [d.date,d.missing?'':d.in,d.max_w??'',d.max_pv_a??'',d.max_charge_a??'',d.max_discharge_a??'',d.max_temp_c??'',d.missing?'':d.hours,d.missing?'':Boolean(d.partial),Boolean(d.missing)].join(',')+'\r\n';const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='PawPower-Tracer-Solar-History.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 function collectGraph(){
  const now=Date.now(),limit=data.mode==='Poll - no dongle'?20:120;
  for(const key of Object.keys(traces)){const i=Number(key),a=data.ages[i],v=data.values[i];if(a===null||a>limit||v===null)continue;const points=traces[key],t=now-a*1000;
   if(!points.length||t-points[points.length-1].t>2000)points.push({t,v:i===6?v*1.8+32:v});
   while(points.length>1200||(points.length&&points[0].t<now-7200000))points.shift();
  }drawGraph();
 }
 function drawGraph(){
  const end=Date.now(),start=end-7200000;
  if(graphView){const span=Math.min(7200000,Math.max(60000,graphView.end-graphView.start));graphView.end=Math.max(start+span,Math.min(end,graphView.end));graphView.start=graphView.end-span;}
  const view=graphView||{start,end},points=traces[$('graph-field').value]||[],g=graphPath(points,view.start,view.end,800,220,data&&data.mode==='Listen - Solar Guardian'?120000:20000);
  // All dynamic SVG attributes are computed numbers; user/controller text is not inserted.
  $('graph').innerHTML=`<svg viewBox="0 0 800 220" style="width:100%;display:block"><path d="M50 12V190H785" fill="none" stroke="#46687e"/><text x="2" y="22" fill="#92aabd" font-size="13">${g.max.toFixed(1)}</text><text x="2" y="190" fill="#92aabd" font-size="13">${g.min.toFixed(1)}</text><path d="${g.path}" fill="none" stroke="#61e4aa" stroke-width="2"/>${g.dots.map(([x,y])=>`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#61e4aa"/>`).join('')}</svg>`;
  $('graph-range').textContent=`${new Date(view.start).toLocaleTimeString()} – ${new Date(view.end).toLocaleTimeString()} · ${g.count} observed samples${graphView?' · zoomed':' · live'}${g.count?'':' · waiting for readings'}`;
 }
 function zoomGraph(factor,fraction=.5){const now=Date.now(),v=graphView||{start:now-7200000,end:now},span=Math.max(60000,Math.min(7200000,(v.end-v.start)*factor)),anchor=v.start+(v.end-v.start)*fraction;graphView={start:anchor-span*fraction,end:anchor+span*(1-fraction)};drawGraph();}
 $('graph-field').value='2';$('graph-field').addEventListener('change',drawGraph);
 $('graph-in').addEventListener('click',()=>zoomGraph(.5));$('graph-out').addEventListener('click',()=>zoomGraph(2));$('graph-live').addEventListener('click',()=>{graphView=null;drawGraph();});
 $('graph').addEventListener('wheel',e=>{e.preventDefault();const box=$('graph').getBoundingClientRect();zoomGraph(e.deltaY<0?.75:1.33,Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)));},{passive:false});
 let drag=null;$('graph').addEventListener('pointerdown',e=>{const now=Date.now();drag={x:e.clientX,view:{...(graphView||{start:now-7200000,end:now})}};$('graph').setPointerCapture(e.pointerId);});
 $('graph').addEventListener('pointermove',e=>{if(!drag)return;const box=$('graph').getBoundingClientRect(),shift=(drag.x-e.clientX)/box.width*(drag.view.end-drag.view.start);graphView={start:drag.view.start+shift,end:drag.view.end+shift};drawGraph();});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])$('graph').addEventListener(type,()=>{drag=null;});
 drawGraph();
 mountPong();
 globalThis.PawPowerCommon.mountNotificationTest();
 setInterval(readHistory,60000);readHistory();
 async function read(){if(busy||document.hidden)return;busy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
 try{const r=await fetch(base+'/text_sensor/'+encodeURIComponent('Tracer Dashboard State'),{cache:'no-store',credentials:'same-origin',signal:controller.signal});if(!r.ok)throw Error('HTTP '+r.status);const entity=await r.json();data=parseSnapshot(entity.value??entity.state);received=performance.now();collectGraph();document.body.classList.remove('offline');$('network').textContent='● ESP32 connected';$('network').style.color='#61e4aa';render();}
 catch(e){document.body.classList.add('offline');$('network').textContent='Connection lost · retrying';$('network').style.color='#ffbc6b';}
 finally{clearTimeout(timer);busy=false;}
 }
 $('mode').addEventListener('change',()=>{editing=true;});
 $('apply').addEventListener('click',async()=>{
  const selected=$('mode').value;
  if(selected==='Poll - no dongle'&&!confirm('Is the Wi-Fi dongle unplugged, along with any other device polling this controller?'))return;
  applying=true;$('apply').disabled=true;$('feedback').textContent='Applying…';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{const r=await fetch(base+'/select/'+encodeURIComponent('Tracer Connection Mode')+'/set?option='+encodeURIComponent(selected),{method:'POST',credentials:'same-origin',signal:controller.signal});if(!r.ok)throw Error('HTTP '+r.status);editing=false;$('feedback').textContent='Mode sent. Watch the reported mode update below the reply count.';}
  catch(e){$('feedback').textContent='Could not confirm the mode change. Check the reported mode before trying again.';}
  finally{clearTimeout(timer);applying=false;$('apply').disabled=false;read();}
 });
 setInterval(()=>{render();if(chargePending&&!chargeSending)read();},1000);setInterval(read,10000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){read();readHistory();}});read();
}
function loadCommon(){
    import('/paw/common.js?v=2').then(()=>{
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
    }).catch(()=>{
      const show=()=>{document.body.textContent='Paw Power could not load shared assets. Retrying…';setTimeout(loadCommon,3000);};
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',show);else show();
    });
  }
  loadCommon();
})();
