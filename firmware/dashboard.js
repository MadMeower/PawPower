(() => {
  'use strict';
  function boot() {
    document.title = 'Paw Power | Battery';
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) { viewport = document.createElement('meta'); viewport.name = 'viewport'; document.head.append(viewport); }
    viewport.content = 'width=device-width, initial-scale=1';
    const style = document.createElement('style');
    style.textContent = `
      :root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1119;color:#eff5fc}
      *{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 20% 0%,#17302d 0,transparent 52%),#0b1119;min-height:100vh}
      main{max-width:960px;margin:auto;padding:20px 20px}header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}
      .header-title{flex:1;min-width:0}h1{font-size:24px;letter-spacing:-1px;margin:0 0 3px}.header-title p{margin:0;font-size:12px}p{color:#93a6b8;margin:5px 0;font-size:14px}.brand{display:flex;align-items:center;gap:10px;margin-bottom:0;flex:none}.brand-mark{width:48px;height:48px;flex:none}.eyebrow{font-size:11px;letter-spacing:3px;color:#64e5b0;font-weight:700}
      #status{font-size:12px;border:1px solid #334557;padding:9px 13px;border-radius:30px;color:#a3b4c7;white-space:nowrap}
      .panel{background:#131e2be8;border:1px solid #263748;border-radius:24px}.hero{display:grid;grid-template-columns:1fr 1fr;align-items:center;padding:22px;margin-bottom:14px;gap:24px}
      .ring{width:230px;height:230px;position:relative;margin:auto}.ring svg{width:100%;height:100%;transform:rotate(-90deg)}circle{fill:none;stroke-width:13}.track{stroke:#253747}#arc{stroke:#64e5b0;stroke-linecap:round;transition:stroke-dasharray .7s,stroke .7s}
      .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.percent{font-size:56px;font-weight:650;letter-spacing:-3px}.percent small{font-size:25px;color:#9aafbd;letter-spacing:0}.caption{color:#9aafbd;font-size:13px}
      #mode{color:#64e5b0;font-size:15px;margin-bottom:8px}.big{font-size:42px;font-weight:650;letter-spacing:-1.5px;margin-bottom:6px}.big small{font-size:20px;font-weight:400;color:#9aafbd;letter-spacing:0}
      .bar{height:6px;background:#263748;border-radius:10px;margin:24px 0 10px;overflow:hidden}#fill{height:100%;width:0;background:#64e5b0;transition:width .7s}.runtime{margin-top:16px;padding-top:12px;border-top:1px solid #263748}.runtime strong{font-size:21px;font-weight:600}.runtime p{font-size:12px;line-height:1.6}.labels{display:flex;justify-content:space-between;color:#93a6b8;font-size:12px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.card{padding:18px}.label{color:#93a6b8;font-size:11px;margin-bottom:7px}.value{font-size:27px;font-weight:600;letter-spacing:-1px}.value small{font-size:15px;font-weight:400;color:#93a6b8;letter-spacing:0}.note{font-size:11px;color:#7f94a6;margin-top:9px}
      .energy-panel{margin-top:14px;padding:14px 18px}.energy-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.energy-number{font-size:22px;font-weight:600}.energy-number small{font-size:12px;font-weight:400;color:#93a6b8}.peak{font-size:11px;margin-top:4px;line-height:1.5;color:#93a6b8}.peak.in{color:#64e5b0}.peak.out{color:#ff7979}.energy-number.in{color:#64e5b0}.energy-number.out{color:#ff7979}.energy-heading{font-size:13px;margin-bottom:12px;display:flex;justify-content:space-between;gap:10px}.energy-heading span{font-size:11px;color:#93a6b8}.history{margin-top:12px;border-top:1px solid #263748;padding-top:10px}.history summary{cursor:pointer;color:#a9bbca;font-size:12px}.history-scroll{max-height:230px;overflow:auto;margin-top:10px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:right;padding:8px;border-bottom:1px solid #263748;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{color:#93a6b8}footer{display:flex;justify-content:space-between;gap:12px;margin-top:16px;color:#7f94a6;font-size:12px}.stale .value,.stale .percent,.stale .big{opacity:.45}
      button{background:#64e5b0;color:#10251d;border:0;border-radius:8px;padding:10px 15px;cursor:pointer;font-weight:650}button:disabled{opacity:.45;cursor:wait}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0}.settings-grid label{display:block;font-size:13px;color:#eff5fc}.settings-grid input,.settings-grid select{display:block;width:100%;margin:6px 0;background:#131e2b;border:1px solid #536779;color:#eff5fc;border-radius:8px;padding:10px;font:inherit}.settings-grid small{display:block;font-size:11px;color:#a9bbca;line-height:1.4}.settings-actions{display:flex;gap:10px;flex-wrap:wrap}#settings-message{font-size:13px;line-height:1.5;color:#ffca75}.settings-grid input:focus{outline:2px solid #64e5b0}
      @media(max-width:650px){main{padding:24px 16px}header{align-items:center;flex-wrap:wrap;gap:12px}.header-title{order:3;flex-basis:100%}#status{margin-left:auto}.settings-grid{grid-template-columns:1fr}.hero{grid-template-columns:1fr;padding:25px;gap:22px}.ring{width:225px;height:225px}.grid{grid-template-columns:repeat(2,1fr)}.energy-grid{grid-template-columns:repeat(2,1fr)}.energy-heading{flex-direction:column}.card{padding:20px}.value{font-size:25px}footer{flex-direction:column}.big{font-size:36px}}
    `;
    document.head.append(style);
    document.body.innerHTML = `<main><header><div class="brand"><svg class="brand-mark" viewBox="0 0 64 64" role="img" aria-label="Paw Power logo"><rect x="1" y="1" width="62" height="62" rx="18" fill="#153c31" stroke="#38775c"/><g fill="#64e5b0"><ellipse cx="16" cy="27" rx="5" ry="7" transform="rotate(-25 16 27)"/><ellipse cx="26" cy="18" rx="5" ry="7" transform="rotate(-10 26 18)"/><ellipse cx="39" cy="18" rx="5" ry="7" transform="rotate(10 39 18)"/><ellipse cx="49" cy="27" rx="5" ry="7" transform="rotate(25 49 27)"/><path d="M20 39c4-4 6-10 12-10s8 6 12 10c8 9 2 17-6 14-4-2-8-2-12 0-8 3-14-5-6-14z"/></g><path d="M34 32l-9 13h7l-2 9 11-15h-8z" fill="#123128"/></svg><div class="eyebrow">PAW POWER</div></div><div class="header-title"><h1>Battery monitor</h1><p id="bank-description">48V bank · Junctek shunt</p></div><div id="status" role="status">Connecting…</div></header>
      <section class="panel hero"><div class="ring" role="img" aria-label="Battery state of charge"><svg viewBox="0 0 240 240" aria-hidden="true"><circle class="track" cx="120" cy="120" r="100"/><circle id="arc" cx="120" cy="120" r="100" stroke-dasharray="0 628.319"/></svg><div class="center"><div class="percent"><span id="soc">—</span><small>%</small></div><span class="caption">STATE OF CHARGE</span></div></div>
      <div><div id="mode">Waiting for shunt</div><div class="big"><span id="hero-power">—</span> <small>W</small></div><p id="flow">Battery power</p><div class="bar"><div id="fill"></div></div><div class="labels"><span id="remaining-label">— Ah remaining</span><span id="total-capacity">— Ah total</span></div><div class="runtime"><div class="label">SHUNT ESTIMATE</div><strong id="shunt-runtime">—</strong><p id="shunt-empty-time">Waiting for shunt estimate</p><div id="runtime-label" class="label" style="margin-top:12px">SMOOTHED ESTIMATE</div><strong id="runtime">—</strong><p id="empty-time">Waiting for discharge readings</p><div class="label" style="margin-top:12px">TIME TO FULL</div><strong id="time-full">—</strong><p id="full-time">Waiting for charge readings</p><p>Steady-rate estimates. Cutoff or charge taper may change timing.</p></div></div></section>
      <section class="grid"><article class="panel card"><div class="label">BATTERY VOLTAGE</div><div class="value"><span id="volts">—</span> <small>V</small></div><div class="note">Measured at shunt</div></article>
      <article class="panel card"><div class="label">BATTERY CURRENT</div><div class="value"><span id="amps">—</span> <small>A</small></div><div class="note">Positive in · Negative out</div></article>
      <article class="panel card"><div class="label">REMAINING CAPACITY</div><div class="value"><span id="ah">—</span> <small>Ah</small></div><div class="note">Shunt capacity counter</div></article>
      <article class="panel card"><div class="label">TEMPERATURE</div><div class="value"><span id="temp">—</span> <small>°F</small></div><div class="note" id="celsius">Battery-mounted probe</div></article>
      <article class="panel card"><div class="label">ENERGY REMAINING</div><div class="value"><span id="energy">—</span> <small>kWh</small></div><div class="note">Estimate at nominal 51.2V</div></article>
      <article class="panel card"><div class="label">DATA AGE</div><div class="value"><span id="age">—</span> <small>s</small></div><div class="note">Since last valid shunt reply</div></article></section>
      <section class="panel energy-panel"><div class="energy-heading">Battery energy<span id="energy-state">Waiting for device clock</span></div><div class="energy-grid"><div><div class="label">TODAY · CHARGED</div><div class="energy-number in"><span id="today-in">—</span> <small>kWh</small></div><div class="peak in" id="today-in-peak">Peak — W · — A</div></div><div><div class="label">TODAY · DISCHARGED</div><div class="energy-number out"><span id="today-out">—</span> <small>kWh</small></div><div class="peak out" id="today-out-peak">Peak — W · — A</div></div><div><div class="label">YESTERDAY · CHARGED</div><div class="energy-number in"><span id="yesterday-in">—</span> <small>kWh</small></div><div class="peak in" id="yesterday-in-peak">Peak — W · — A</div></div><div><div class="label">YESTERDAY · DISCHARGED</div><div class="energy-number out"><span id="yesterday-out">—</span> <small>kWh</small></div><div class="peak out" id="yesterday-out-peak">Peak — W · — A</div></div></div><details class="history"><summary>Previous 30 days · Michigan time</summary><div class="history-scroll"><table><thead><tr><th>Date</th><th>Charged kWh</th><th>Discharged kWh</th><th>Peak +W</th><th>Peak −W</th><th>Peak +A</th><th>Peak −A</th><th>Coverage</th></tr></thead><tbody id="energy-history"></tbody></table></div><p class="note">Partial = started mid-day, restarted, or missed readings. These are battery totals, not total house use. Peaks are independent maxima from 5-second samples, recorded since this feature was installed; brief spikes may be missed.</p></details></section>
      <details class="history"><summary>Disconnects · Shunt <span id="shunt-drops">—</span> / Webpage <span id="web-drops">0</span> today</summary><p class="note" id="shunt-last-drop">Shunt: waiting for history</p><p class="note" id="web-last-drop">Webpage: no drops recorded</p><div class="history-scroll"><table><thead><tr><th>Date</th><th>Shunt drops</th><th>Offline</th><th>Webpage drops</th><th>Offline</th></tr></thead><tbody id="disconnect-history"></tbody></table></div><p class="note">Shunt: no valid reply for 20 seconds. Webpage: event-stream error or 15 seconds without events. Each outage counts once. Webpage records belong to this browser; closed-page time and ESP32 downtime are not measured. Michigan dates.</p></details><details class="history"><summary>CAN output · Pylontech</summary><p class="note">500 kbps · Pylontech · <span id="can-state">Waiting for state</span></p><p class="note" id="can-output-status">Waiting for CAN status</p><button id="can-toggle" type="button">Enable CAN output</button><p class="note">Enables after 3 fresh shunt replies. Pauses on stale data and resumes automatically. Last on/off choice is saved. <span id="can-soc-rules">SOC rules: waiting for settings.</span></p></details><details class="history" id="battery-settings"><summary>Battery settings · Saved on device</summary><p class="note">48V LiFePO₄ profiles only. Match these limits to your battery and inverter specifications. Editing does nothing until Apply saves the complete profile. First installation or temperature-protection upgrade requires a reviewed Apply before CAN can run. Existing inverter limits still apply.</p><form id="settings-form"><fieldset id="settings-fields" disabled style="border:0;padding:0;margin:0"><div class="settings-grid" id="settings-grid"></div><div class="settings-actions"><button type="submit" id="settings-apply">Apply &amp; save to flash</button><button type="button" id="settings-reload">Reload saved values</button></div></fieldset></form><p id="settings-message" role="status" aria-live="polite">Waiting for device settings…</p><p class="note">SOC is calculated from remaining Ah / configured capacity. This does not recalibrate or reprogram the Junctek shunt. A 100% SOC stop still requires suitable voltage limits. Hold voltage is advertised while charging is disabled; it is not an active float stage. Current limits are bank totals, not per battery. Temperature protection blocks charging only. At startup or after rejected/stale readings, each enabled protection must reach its resume threshold. Place the probe on a representative battery.</p></details><details class="history"><summary>Device memory</summary><p class="note">Free heap: <span id="heap-free">—</span> KiB · Largest free block: <span id="heap-block">—</span> KiB · Max loop interval: <span id="loop-ms">—</span> ms</p><p class="note">Live working memory, not firmware size or CPU utilization. Bluetooth disabled.</p></details><footer><span>Local monitor · Refreshes every 5 seconds</span><span id="updated">Waiting for live data</span></footer></main>`;
    const $ = id => document.getElementById(id);
    const settingFields = [
      ['Capacity','Ah',1,10000,0.1,'Total bank capacity, used for SOC and time-to-full, and reported to the inverter over CAN (whole Ah).'],
      ['Stop charging at','%',50,100,0.1,'Charging permission turns off at this SOC.'],
      ['Resume charging at','%',0,99,0.1,'Must be at least 1% below the stop threshold.'],
      ['Charging voltage','V',48,60,0.1,'Maximum charging voltage advertised to the inverter.'],
      ['Charge-hold voltage','V',40,60,0.1,'Advertised during SOC or temperature hold, with charging disabled.'],
      ['Charge current limit','A',1,600,0.1,'Total allowed charging current for the bank.'],
      ['Discharge current limit','A',1,600,0.1,'Total allowed discharge current for the bank.'],
      ['Discharge cutoff','V',40,56,0.1,'Discharge permission turns off at or below this voltage.'],
      ['Discharge recovery','V',40,60,0.1,'Discharge resumes here; at least 0.5 V above cutoff.'],
      ['Low-voltage warning','V',40,60,0.1,'Warning threshold between cutoff and recovery.'],
      ['Cold-charge protection','on/off',0,1,1,'Uses the shunt temperature probe.'],
      ['Cold charging stop','°F',null,null,0.1,'Stops charging at or below this temperature. No preset temperature range.'],
      ['Cold charging resume','°F',null,null,0.1,'Resumes at or above this temperature; must be higher than stop.'],
      ['High-temperature charge protection','on/off',0,1,1,'Uses the same shunt temperature probe.'],
      ['Hot charging stop','°F',null,null,0.1,'Stops charging at or above this temperature. No preset temperature range.'],
      ['Hot charging resume','°F',null,null,0.1,'Resumes at or below this temperature; must be lower than stop.']
    ];
    $('settings-grid').innerHTML=settingFields.map((f,i)=>`<label for="setting-${i}">${f[0]} (${f[1]})${(i===10 || i===13)?`<select id="setting-${i}"><option value="1">Enabled</option><option value="0">Disabled</option></select>`:`<input id="setting-${i}" type="number" ${f[2]===null?'':`min="${f[2]}" max="${f[3]}"`} step="${f[4]}" required>`}<small>${f[5]} ${f[2]===null?'':`Range ${f[2]}–${f[3]} ${f[1]}.`}</small></label>`).join('');
    let settingsActive=null, settingsDraftRevision=null, settingsDirty=false, settingsPending=false;
    let capacity=1120; // Existing installation fallback until device settings arrive.
    settingFields.forEach((_,i)=>{$('setting-'+i).oninput=()=>{settingsDirty=true;$('settings-message').textContent='Unsaved changes. Apply saves all values together.';};});
    function fillSettings(){
      if(!settingsActive)return;
      settingsActive.values.forEach((v,i)=>{$('setting-'+i).value=String(v);});
      settingsDraftRevision=settingsActive.revision;settingsDirty=false;
      $('settings-message').textContent=settingsActive.message;
    }
    function settingsFromEvent(data){
      const state=JSON.parse(data.state);
      if(!Number.isInteger(state.revision) || !Array.isArray(state.values) || state.values.length!==settingFields.length || !state.values.every(Number.isFinite))throw new Error('Invalid settings response');
      // Stored temperatures and shunt readings stay Celsius. UI is Fahrenheit.
      state.values=state.values.map((v,i)=>[11,12,14,15].includes(i)?Number((v*9/5+32).toFixed(1)):v);
      return state;
    }
    function receiveSettings(data){
      let next;try{next=settingsFromEvent(data);}catch(_){return;}
      settingsActive=next;capacity=next.values[0];
      $('bank-description').textContent=`48V bank · Junctek shunt · ${capacity.toLocaleString()}Ah`;
      $('total-capacity').textContent=`${capacity.toLocaleString()} Ah total`;
      $('can-soc-rules').textContent=`SOC hold: stop ${next.values[1]}%, resume ${next.values[2]}%. Cold protection: ${next.values[10] ? `stop ≤${next.values[11]}°F, resume ≥${next.values[12]}°F` : 'disabled'}. Hot protection: ${next.values[13] ? `stop ≥${next.values[14]}°F, resume ≤${next.values[15]}°F` : 'disabled'}.`;
      if(!settingsPending){
        $('settings-fields').disabled=false;
        if(!settingsDirty)fillSettings();
        else if(settingsDraftRevision!==next.revision)$('settings-message').textContent='Settings changed elsewhere. Reload saved values before applying your edits.';
      }
    }
    $('settings-reload').onclick=()=>{if(!settingsPending)fillSettings();};
    $('settings-form').onsubmit=async event=>{
      event.preventDefault();if(new URLSearchParams(location.search).has('demo')){$('settings-message').textContent='Preview only. No device settings are saved.';return;}
      if(settingsPending || !settingsActive)return;
      const draft=settingFields.map((_,i)=>Number($('setting-'+i).value));
      let error='';
      if(draft.some((v,i)=>!Number.isFinite(v) || $('setting-'+i).value.trim()==='' || (settingFields[i][2]!==null && (v<settingFields[i][2] || v>settingFields[i][3]))))error='Check the numeric ranges shown in the fields.';
      else if(draft.some(v=>Math.abs(v*10-Math.round(v*10))>0.001))error='Use at most one decimal place.';
      else if(draft[2]>draft[1]-1)error='Resume SOC must be at least 1% below stop SOC.';
      else if(draft[7]>=draft[4] || draft[4]>draft[3])error='Require cutoff < hold voltage ≤ charging voltage.';
      else if(draft[8]<draft[7]+0.5 || draft[8]>=draft[3])error='Recovery must be at least 0.5 V above cutoff and below charging voltage.';
      else if(draft[9]<draft[7] || draft[9]>draft[8])error='Warning voltage must be between cutoff and recovery.';
      else if(![0,1].includes(draft[10]))error='Cold protection must be enabled or disabled.';
      else if(draft[12]<=draft[11])error='Cold resume must be higher than stop.';
      else if(![0,1].includes(draft[13]))error='Hot protection must be enabled or disabled.';
      else if(draft[15]>=draft[14])error='Hot resume must be lower than stop.';
      else if(settingsDraftRevision!==settingsActive.revision)error='Settings changed elsewhere. Reload saved values first.';
      if(error){$('settings-message').textContent=error;return;}
      const wireValues=draft.map((v,i)=>[11,12,14,15].includes(i)?((v-32)*5/9).toFixed(6):String(v));
      const revision=settingsDraftRevision;
      settingsPending=true;$('settings-fields').disabled=true;
      $('settings-message').textContent='Saving complete profile to device flash…';
      try{
        const response=await fetch('/text/'+encodeURIComponent('Battery Settings Apply')+'/set?value='+encodeURIComponent(revision+'|'+wireValues.join(',')),{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
        if(!response.ok)throw new Error('Save request failed: HTTP '+response.status);
        let confirmed=false;
        for(let attempt=0;attempt<8;++attempt){
          await new Promise(resolve=>setTimeout(resolve,500));
          const check=await fetch('/text_sensor/'+encodeURIComponent('Battery Settings State'),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000)});
          if(!check.ok)throw new Error('Cannot confirm save: HTTP '+check.status);
          const data=await check.json(), saved=settingsFromEvent(data);
          receiveSettings(data);
          if(saved.saved && saved.revision>=revision && saved.values.every((v,i)=>Math.abs(v-draft[i])<0.0006)){confirmed=true;break;}
          if(saved.revision!==revision || /failed|Invalid|outside|Require|must|Expected|elsewhere|unavailable|exhausted|decimal/.test(saved.message))throw new Error(saved.message);
        }
        if(!confirmed)throw new Error('Save not confirmed. Reload saved values before retrying.');
        settingsDirty=false;fillSettings();$('settings-message').textContent='Saved to device flash. CAN resumes after three fresh shunt readings.';
      }catch(e){$('settings-message').textContent=e.message+' Your draft has been kept.';}
      finally{settingsPending=false;$('settings-fields').disabled=false;}
    };
    let canEnabled = false;
    $('can-toggle').onclick = async () => {
      $('can-toggle').disabled = true;
      try {
        const action = canEnabled ? 'turn_off' : 'turn_on';
        const response = await fetch('/switch/' + encodeURIComponent('CAN Bench Output') + '/' + action, {method:'POST'});
        if (!response.ok) throw new Error('HTTP ' + response.status);
      } catch (_) { $('can-state').textContent = 'Request failed; check connection'; }
      finally { $('can-toggle').disabled = false; }
    };
    const values = {};
    let historyPayload = null, historyAt = 0;
    let averageDischarge = null, averageCharge = null, lastCurrentAt = 0, previousCharging = false;
    let transport = false, lastTransport = 0, ageReceived = 0, ageAt = 0, hasAge = false;
    let stream=null, connectionAt=0, retryAt=0, retryDelay=2000;
    let connectionHistory = null, webWasLive = false, webActive = false;
    let webTickAt = Date.now(), webSavedAt = 0;
    let webHistory = {days:[],lastStart:0,lastDuration:0,interrupted:false};
    try {
      const saved=JSON.parse(localStorage.getItem('paw-web-disconnects-v1'));
      if (saved && Array.isArray(saved.days)) {
        webHistory=saved;
        webHistory.interrupted=!!saved.active || !!saved.interrupted;
      }
    } catch (_) {}
    function michiganDate(ms) {
      const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
      const part=type=>parts.find(p=>p.type===type).value;
      return `${part('year')}-${part('month')}-${part('day')}`;
    }
    function webDay(ms) {
      const date=michiganDate(ms);
      let day=webHistory.days.find(d=>d.date===date);
      if (!day) {day={date,count:0,seconds:0};webHistory.days.push(day);webHistory.days.sort((a,b)=>b.date.localeCompare(a.date));webHistory.days=webHistory.days.slice(0,31);}
      return day;
    }
    function saveWeb() {
      webHistory.active=webActive;
      try {localStorage.setItem('paw-web-disconnects-v1',JSON.stringify(webHistory));}catch(_){}
      webSavedAt=Date.now();
    }
    function tickWeb() {
      const now=Date.now(),dt=(now-webTickAt)/1000;
      if(webActive && (dt>5 || dt<0))webHistory.interrupted=true;
      if (webActive && dt>0 && dt<=5) {
        webHistory.lastDuration+=dt;
        // Assign the observed interval to Michigan calendar dates at second resolution.
        const slices=Math.ceil(dt);
        for(let i=0;i<slices;i++)webDay(webTickAt+(i+0.5)*dt/slices*1000).seconds+=dt/slices;
        if(now-webSavedAt>=10000)saveWeb();
      }
      webTickAt=now;
    }
    function webLost() {
      tickWeb();
      if (webWasLive && !webActive) {
        webActive=true;webHistory.lastStart=Date.now();webHistory.lastDuration=0;webHistory.interrupted=false;
        webDay(Date.now()).count++;saveWeb();
      }
    }
    function webLive() {
      tickWeb();
      if(webActive){webActive=false;saveWeb();}
      webWasLive=true;transport=true;lastTransport=Date.now();
      retryAt=0;retryDelay=2000;
    }
    function duration(seconds) {
      if(!Number.isFinite(seconds))return '—';
      const n=Math.floor(Math.max(0,seconds));
      return n>=3600?`${Math.floor(n/3600)}h ${Math.floor(n%3600/60)}m`:n>=60?`${Math.floor(n/60)}m ${n%60}s`:`${n}s`;
    }
    function dropDescription(label,start,seconds,active,interrupted) {
      if(!start)return `${label}: no drops recorded`;
      const when=new Date(start).toLocaleString(undefined,{timeZone:'America/Detroit',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'});
      return `${label}: last ${when} · ${duration(seconds)}${active?' · ongoing':interrupted?' · interrupted; duration incomplete':''}`;
    }
    function renderDisconnects() {
      const now=Date.now(),date=michiganDate(now),web=webDay(now);
      const history=connectionHistory;
      const shunt=history?.days?.find(d=>d.date===date);
      $('shunt-drops').textContent=shunt&&!shunt.missing?String(shunt.count):'—';
      $('web-drops').textContent=String(web.count);
      $('shunt-last-drop').textContent=history?.clock?dropDescription('Shunt',history.last_start*1000,history.last_duration,history.active,history.interrupted):'Shunt: waiting for device clock/history';
      $('web-last-drop').textContent=dropDescription('Webpage',webHistory.lastStart,webHistory.lastDuration,webActive,webHistory.interrupted);
      const dates=[...new Set([...(history?.days||[]).map(d=>d.date),...webHistory.days.map(d=>d.date)])].filter(d=>d<=date).sort().reverse().slice(0,31);
      const body=$('disconnect-history');body.textContent='';
      dates.forEach(date=>{
        const shunt=history?.days?.find(d=>d.date===date),web=webHistory.days.find(d=>d.date===date);
        const row=document.createElement('tr');
        [date,shunt&&!shunt.missing?String(shunt.count):'—',shunt&&!shunt.missing?duration(shunt.seconds):'—',web?String(web.count):'—',web?duration(web.seconds):'—'].forEach(text=>{const cell=document.createElement('td');cell.textContent=text;row.append(cell);});body.append(row);
      });
    }
    if(typeof addEventListener==='function')addEventListener('pagehide',()=>{tickWeb();saveWeb();});
    const known = ['battery_voltage','battery_current','battery_remaining_capacity','battery_soc','battery_temperature','shunt_data_age','shunt_remaining_time'];
    function receive(data) {
      const raw = decodeURIComponent(String(data.name_id || data.id || data.name || '')).toLowerCase();
      const normalized = raw.replace(/[^a-z0-9]+/g,'_');
      if (normalized.endsWith('battery_settings_state')) {receiveSettings(data);return;}
      if (normalized.endsWith('can_output_status')) {
        $('can-output-status').textContent=String(data.state || 'Waiting for CAN status');return;
      }
      if (normalized.endsWith('can_bench_output')) {
        canEnabled = data.value === true || data.value === 1 || String(data.state).toUpperCase() === 'ON';
        $('can-state').textContent = canEnabled ? 'Enabled · see status below' : 'Off';
        $('can-toggle').textContent = canEnabled ? 'Disable CAN output' : 'Enable CAN output';
        return;
      }
      const memoryFields = {heap_free:'heap-free',heap_largest_block:'heap-block',loop_time:'loop-ms'};
      const memoryKey = Object.keys(memoryFields).find(k => normalized.endsWith(k));
      if (memoryKey) {
        const number = typeof data.value === 'number' ? data.value : parseFloat(data.state);
        if (Number.isFinite(number)) $(memoryFields[memoryKey]).textContent = number.toFixed(1);
        return;
      }
      if (normalized.endsWith('connection_history')) {
        try {const history=JSON.parse(data.state);if(Array.isArray(history.days)){connectionHistory=history;renderDisconnects();}}catch(_){}
        return;
      }
      if (normalized.endsWith('battery_energy_history')) {
        try {
          const history = JSON.parse(data.state);
          if (!Array.isArray(history.days)) return;
          historyPayload = history; historyAt = Date.now(); renderEnergy();
        } catch (_) {}
        return;
      }
      const key = known.find(k => normalized.endsWith(k));
      if (!key) return;
      const v = typeof data.value === 'number' ? data.value : parseFloat(data.state);
      if (!Number.isFinite(v)) return;
      values[key] = v;
      if (key === 'battery_current') {
        const now = Date.now();
        const gap = (now - lastCurrentAt) / 1000;
        if (v < -0.15) {
          const draw = -v;
          if (averageDischarge === null || gap > 20) averageDischarge = draw;
          else {
            const weight = 1 - Math.exp(-Math.max(0, gap) / 60);
            averageDischarge += weight * (draw - averageDischarge);
          }
        }
        if (v > 0.15) {
          if (averageCharge === null || !previousCharging || gap > 20) averageCharge = v;
          else averageCharge += (1 - Math.exp(-Math.max(0, gap) / 60)) * (v - averageCharge);
        }
        previousCharging = v > 0.15;
        lastCurrentAt = now;
      }
      if (key === 'shunt_data_age') { ageReceived = v; ageAt = Date.now(); hasAge = true; }
      transport = true; lastTransport = Date.now(); render();
    }
    function renderEnergy() {
      const history = historyPayload;
      if (!history || !history.clock) { $('energy-state').textContent = 'Waiting for device clock'; return; }
      const days = history.days;
      function number(i,field) { return days[i] && !days[i].missing && Number.isFinite(days[i][field]) ? days[i][field].toFixed(2) : '—'; }
      $('today-in').textContent=number(0,'in');$('today-out').textContent=number(0,'out');
      $('yesterday-in').textContent=number(1,'in');$('yesterday-out').textContent=number(1,'out');
      function peakValue(day,index,sign,decimals) {
        const peak=day?.peak;
        if (day?.missing || !Array.isArray(peak) || !Number.isFinite(peak[index])) return '—';
        return (peak[index]>0?sign:'') + peak[index].toFixed(decimals);
      }
      ['today','yesterday'].forEach((label,index)=>{
        const day=days[index];
        $(label+'-in-peak').textContent=`Peak ${peakValue(day,0,'+',0)} W · ${peakValue(day,2,'+',1)} A`;
        $(label+'-out-peak').textContent=`Peak ${peakValue(day,1,'−',0)} W · ${peakValue(day,3,'−',1)} A`;
      });
      const age=hasAge ? ageReceived+(Date.now()-ageAt)/1000 : NaN;
      const stale = !transport || Date.now()-historyAt>30000 || !(age>=0 && age<20);
      $('energy-state').textContent=stale?'Saved totals · Monitoring paused':days[0]?.partial?'Today partial · Counts on ESP32':'Live · Counts on ESP32';
      const body=$('energy-history');body.textContent='';
      days.slice(1,31).forEach(day=>{
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) return;
        const row=document.createElement('tr');
        const cells=[day.date,day.missing?'—':fmt(day.in,2),day.missing?'—':fmt(day.out,2),peakValue(day,0,'+',0),peakValue(day,1,'−',0),peakValue(day,2,'+',1),peakValue(day,3,'−',1),day.missing?'No data':`${day.partial?'Partial · ':''}${fmt(day.hours,1)}h`];
        cells.forEach(text=>{const cell=document.createElement('td');cell.textContent=text;row.append(cell);});body.append(row);
      });
    }
    function fmt(v,n) { return Number.isFinite(v) ? v.toFixed(n) : '—'; }
    function socColor(soc) {
      if (!Number.isFinite(soc)) return '#93a6b8';
      const stops = [
        [10, [217, 54, 79]],   // deep red
        [20, [255, 79, 87]],   // red
        [30, [255, 159, 67]],  // orange
        [50, [190, 220, 83]],  // yellow-green
        [90, [66, 239, 133]]   // bright green
      ];
      const value = Math.max(0, Math.min(100, soc));
      if (value <= stops[0][0]) return 'rgb(' + stops[0][1].join(',') + ')';
      for (let i = 1; i < stops.length; i++) {
        if (value <= stops[i][0]) {
          const [low, a] = stops[i - 1], [high, b] = stops[i];
          const ratio = (value - low) / (high - low);
          return 'rgb(' + a.map((channel, j) => Math.round(channel + (b[j] - channel) * ratio)).join(',') + ')';
        }
      }
      return 'rgb(' + stops[stops.length - 1][1].join(',') + ')';
    }
    function render() {
      tickWeb();
      if(webWasLive && Date.now()-lastTransport>=15000)webLost();
      renderDisconnects();
      const v=values.battery_voltage,a=values.battery_current,ah=values.battery_remaining_capacity,s=values.battery_soc,t=values.battery_temperature;
      const age=hasAge ? ageReceived+(Date.now()-ageAt)/1000 : NaN;
      const connected=transport && Date.now()-lastTransport<15000;
      const fresh=connected && hasAge && age>=0 && age<20;
      document.body.classList.toggle('stale',!fresh);
      $('status').textContent=!connected?'Webpage disconnected':!hasAge||age<0?'Waiting for shunt':!fresh?'Shunt data stale':'● Live shunt data';
      $('status').style.color=fresh?'#64e5b0':'#ffca75';
      $('soc').textContent=fmt(s,1);$('volts').textContent=fmt(v,2);$('amps').textContent=fmt(a,2);$('ah').textContent=fmt(ah,1);
      $('temp').textContent=fmt(t*9/5+32,1);$('celsius').textContent=Number.isFinite(t)?`${fmt(t,1)} °C · Battery-mounted probe`:'Battery-mounted probe';
      $('energy').textContent=fmt(ah*51.2/1000,1);$('age').textContent=age>=0?fmt(age,0):'—';
      $('remaining-label').textContent=`${fmt(ah,1)} Ah remaining`;
      const power=v*a;$('hero-power').textContent=fmt(Math.abs(power),0);
      const charging=a>0.15,discharging=a< -0.15;
      const flowColor = !fresh ? '#93a6b8' : charging ? '#64e5b0' : discharging ? '#ff7979' : '#93a6b8';
      ['mode','amps','hero-power'].forEach(k => { $(k).style.color = flowColor; });
      if (fresh) $('status').style.color = flowColor;
      $('mode').textContent=!fresh?'Waiting for fresh shunt data':charging?'↑ Charging':discharging?'↓ Discharging':'Battery idle';
      $('flow').textContent=charging?'Power flowing into the bank':discharging?'Power flowing out of the bank':'Battery power';
      let duration = '—', empty = 'Waiting for discharge readings';
      if (!fresh) empty = 'Unavailable until fresh shunt data arrives';
      else if (Number.isFinite(ah) && averageDischarge > 0 && Date.now()-lastCurrentAt < 20000) {
        const hours = Math.max(0, ah) / averageDischarge;
        if (hours > 24*365) { duration = '> 1 year'; empty = 'Load too low for a useful empty-time estimate'; }
        else {
          const minutes = Math.round(hours * 60);
          duration = `${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,'0')}m`;
          empty = (discharging ? 'Estimated empty: ' : 'If discharge resumed now, empty: ') + new Date(Date.now()+hours*3600000).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'}) +
            ` · ${averageDischarge.toFixed(1)}A average draw`;
        }
      }
      let shuntDuration = '—', shuntEmpty = 'Waiting for shunt estimate';
      const shuntMinutes = values.shunt_remaining_time;
      if (!fresh) shuntEmpty = 'Unavailable until fresh shunt data arrives';
      else if (charging) { shuntDuration = 'Charging'; shuntEmpty = 'Runtime resumes when the bank is discharging'; }
      else if (!discharging) { shuntDuration = 'Idle'; shuntEmpty = 'Load too low for a useful estimate'; }
      else if (Number.isFinite(shuntMinutes) && shuntMinutes >= 0 && shuntMinutes <= 525600) {
        const minutes = Math.round(shuntMinutes);
        shuntDuration = `${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,'0')}m`;
        shuntEmpty = 'Estimated empty: ' + new Date(Date.now()+minutes*60000).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'});
      }
      $('shunt-runtime').textContent = shuntDuration;
      $('shunt-empty-time').textContent = shuntEmpty;
      $('runtime-label').textContent = discharging ? 'SMOOTHED ESTIMATE' : 'AT LAST DISCHARGE LOAD';
      $('runtime').textContent = duration;
      $('empty-time').textContent = empty;
      let fullDuration = '—', fullDescription = 'Available while charging';
      if (!fresh) fullDescription = 'Unavailable until fresh shunt data arrives';
      else if (Number.isFinite(ah) && ah >= capacity) { fullDuration = 'Full'; fullDescription = `At configured ${capacity.toLocaleString()}Ah capacity`; }
      else if (charging && Number.isFinite(ah) && averageCharge > 0 && Date.now()-lastCurrentAt < 20000) {
        const hours = Math.max(0,capacity-ah) / averageCharge;
        if (hours > 24*365) { fullDuration = '> 1 year'; fullDescription = 'Charge rate too low for a useful full-time estimate'; }
        else {
          const minutes = Math.round(hours*60);
          fullDuration = `${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,'0')}m`;
          fullDescription = 'Estimated full: ' + new Date(Date.now()+hours*3600000).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'}) + ` · ${averageCharge.toFixed(1)}A average charge`;
        }
      }
      $('time-full').textContent = fullDuration;
      $('time-full').style.color = fresh && charging ? '#64e5b0' : '#93a6b8';
      $('full-time').textContent = fullDescription;
      const color=socColor(s);
      const percent=Number.isFinite(s)?Math.max(0,Math.min(100,s)):0;
      $('arc').setAttribute('stroke-dasharray',`${percent*6.28319} 628.319`);$('arc').style.stroke=color;$('fill').style.width=`${percent}%`;$('fill').style.background=color;
      document.querySelector('.ring').setAttribute('aria-label',`Battery state of charge ${fmt(s,1)} percent`);
      renderEnergy();
      $('updated').textContent=fresh?'Shunt connected · Checksums validated':'Readings dimmed until fresh data arrives';
    }
    if (new URLSearchParams(location.search).has('demo')) {
      receiveSettings({state:JSON.stringify({revision:1,saved:true,values:[1120,95,93,56.8,54,125,140,48,50.8,49,1,2,5,1,45,40],message:'Preview only. No device settings are saved.'})});
      Object.entries({battery_voltage:52.93,battery_current:-30.16,battery_remaining_capacity:1002.51,battery_soc:89.5,battery_temperature:31,shunt_remaining_time:1993,shunt_data_age:1}).forEach(([k,v])=>receive({id:'sensor/'+k,value:v}));
      receive({id:'text_sensor/Battery Energy History',state:JSON.stringify({clock:true,days:[{date:'2026-10-29',in:12.34,out:8.76,hours:6,partial:true,peak:[5400,7420,105,145]},{date:'2026-10-28',in:30.21,out:28.1,hours:24,partial:false,peak:[5100,6200,100,120]}]})});
      $('status').textContent='Preview · Sample data';$('updated').textContent='Sample values only'; return;
    }
    function retryConnection(){
      webLost();transport=false;
      if(!retryAt){retryAt=Date.now()+retryDelay;retryDelay=Math.min(30000,retryDelay*2);}
    }
    function connect(){
      // Close the abandoned connection before creating another. Late callbacks
      // from the old stream cannot change the current connection's status.
      const previous=stream;stream=null;
      if(previous)previous.close();
      transport=false;connectionAt=Date.now();retryAt=0;
      try{
        const current=new EventSource('/events');stream=current;
        current.addEventListener('state',e=>{
          if(stream!==current)return;
          try{const data=JSON.parse(e.data);webLive();receive(data);}catch(_){}
        });
        current.onopen=()=>{if(stream===current)connectionAt=Date.now();};
        current.onerror=()=>{if(stream!==current)return;retryConnection();render();};
        current.addEventListener('ping',()=>{if(stream!==current)return;webLive();render();});
      }catch(_){retryConnection();}
    }
    function connectionTick(){
      const now=Date.now();
      // EventSource can remain nominally open after the server stops delivering.
      // Check actual events, including ESPHome keepalive pings, not readyState.
      if(!retryAt && now-Math.max(connectionAt,lastTransport)>=15000)retryConnection();
      if(retryAt && now>=retryAt)connect();
      render();
    }
    connect();setInterval(connectionTick,1000);render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
