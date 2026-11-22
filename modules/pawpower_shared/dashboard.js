(() => {
  'use strict';
  // Seasonal calendar guide, not astronomical event timing or PV prediction.
  // UTC arithmetic on calendar dates avoids DST-related 23/25-hour day errors.
  function seasonalCycle(isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
    const [year, month, day] = isoDate.split('-').map(Number);
    const stamp = Date.UTC(year, month - 1, day);
    if (new Date(stamp).toISOString().slice(0,10) !== isoDate) return null;
    const summer = Date.UTC(year,5,21), winter = Date.UTC(year,11,21);
    const decreasing = stamp >= summer && stamp < winter;
    const base = stamp >= winter ? winter : Date.UTC(year-1,11,21);
    const end = stamp >= winter ? Date.UTC(year+1,11,21) : winter;
    const target = decreasing ? winter : (stamp >= winter ? Date.UTC(year+1,5,21) : summer);
    const phase = (stamp-base)/(end-base), angle = phase*2*Math.PI;
    return { days: Math.round((target-stamp)/86400000), decreasing,
      event: stamp===summer ? 'Summer solstice day' : stamp===winter ? 'Winter solstice day' : null,
      target: decreasing ? 'winter' : 'summer',
      x: 50-32*Math.sin(angle), y: 50+32*Math.cos(angle) };
  }
  // End seasonal calendar calculation.
  // Minute history helpers. UTC positions keep DST's repeated hour unambiguous.
  function historyDayBounds(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid date.');
    const midday = Date.parse(date + 'T12:00:00Z');
    if (!Number.isFinite(midday) || new Date(midday).toISOString().slice(0,10) !== date) throw new Error('Choose a valid date.');
    const formatter = new Intl.DateTimeFormat('en-US', {timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit'});
    const localDate = ms => {
      const parts = formatter.formatToParts(new Date(ms));
      const get = type => parts.find(p => p.type === type).value;
      return `${get('year')}-${get('month')}-${get('day')}`;
    };
    const boundary = target => {
      let low = Math.floor((midday-36*3600000)/60000), high = Math.ceil((midday+36*3600000)/60000);
      while (low < high) {
        const middle = Math.floor((low+high)/2);
        if (localDate(middle*60000) < target) low = middle+1; else high = middle;
      }
      return low*60000;
    };
    return {start:boundary(date), end:boundary(new Date(midday+86400000).toISOString().slice(0,10))};
  }
  function parseMinuteHistory(csv, date) {
    const bounds = historyDayBounds(date);
    const header = 'utc_start,local_start,coverage_s,quality,soc_pct,volts,amps,watts,charged_wh,discharged_wh';
    const lines = csv.replace(/^\uFEFF/,'').split(/\r?\n/);
    const actualHeader=lines.shift();
    const hasTemperature=actualHeader===header+',temp_c';
    if (actualHeader!==header && !hasTemperature) throw new Error('Unsupported battery history CSV header.');
    let invalid=0, duplicates=0;
    // An unterminated final row may be an interrupted append, even if it looks numeric.
    if (!csv.endsWith('\n') && lines.length) {if(lines.pop().trim()) invalid++;}
    const byTime = new Map();
    const qualities = new Set(['complete','partial','startup_partial','clock_gap','missing']);
    for (const line of lines) {
      if (!line.trim()) continue;
      const cells = line.split(',');
      const time = Date.parse(cells[0]);
      const coverage = cells[2]?.trim() ? Number(cells[2]) : NaN;
      if (cells.length !== (hasTemperature?11:10) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(cells[0]) ||
          !Number.isFinite(time) || new Date(time).toISOString().replace('.000Z','Z') !== cells[0] ||
          !Number.isFinite(coverage) || coverage<0 || coverage>62 || !qualities.has(cells[3])) {invalid++;continue;}
      if (time<bounds.start || time>=bounds.end) {invalid++;continue;}
      const numbers = cells.slice(4,10).map(v => v.trim()==='' ? null : Number(v));
      const missing = cells[3]==='missing';
      if ((missing && (coverage!==0 || numbers.some(v=>v!==null))) ||
          (!missing && (coverage<=0 || numbers.some(v=>v===null || !Number.isFinite(v) || Math.abs(v)>1e9) ||
           numbers[0]<0 || numbers[0]>100 || numbers[4]<0 || numbers[5]<0))) {invalid++;continue;}
      const temp=hasTemperature && cells[10].trim()!=='' ? Number(cells[10]) : null;
      if(temp!==null && (!Number.isFinite(temp) || temp < -100 || temp > 200 || missing)) {invalid++;continue;}
      const row = {volts:numbers[1],temp, time,coverage,quality:cells[3],valid:!missing,soc:numbers[0],watts:numbers[3],
        chargedWh:numbers[4],dischargedWh:numbers[5],complete:cells[3]==='complete' && coverage>=59.5};
      if (byTime.has(time)) duplicates++;
      byTime.set(time,row); // Most recent record wins after clock corrections/restarts.
    }
    const rows = [...byTime.values()].sort((a,b)=>a.time-b.time);
    const valid = rows.filter(r=>r.valid);
    return {date,...bounds,rows,byTime,invalid,duplicates,validCount:valid.length,
      partialCount:valid.filter(r=>!r.complete).length,missingCount:rows.filter(r=>!r.valid).length,
      coverage:valid.reduce((n,r)=>n+r.coverage,0),
      chargedWh:valid.reduce((n,r)=>n+r.chargedWh,0),dischargedWh:valid.reduce((n,r)=>n+r.dischargedWh,0)};
  }
  function historyRuns(model,key) {
    const runs = []; let run = [];
    for (const row of model.rows) {
      if (!row.valid || (key && !Number.isFinite(row[key]))) {if(run.length)runs.push(run);run=[];continue;}
      if (!row.complete) {if(run.length)runs.push(run);runs.push([row]);run=[];continue;}
      if (run.length && row.time-run[run.length-1].time!==60000) {runs.push(run);run=[];}
      run.push(row);
    }
    if(run.length)runs.push(run);
    return runs;
  }
  function treatEquivalent(kwh,rate,price) {
    return [kwh,rate,price].every(Number.isFinite) && kwh>=0 && rate>=0 && price>0 ? kwh*rate/price : null;
  }
  const eventNames={1:'Device startup observed (clock available)',2:'Shunt data stale · CAN freshness timeout',3:'Shunt replies restored',
    4:'Cold charging hold started',5:'Cold charging hold cleared',6:'Hot charging hold started',7:'Hot charging hold cleared',
    8:'SOC charging hold started',9:'SOC charging hold cleared',10:'Bridge charge permission denied',11:'Bridge charge permission allowed',
    12:'CAN output switched off',13:'CAN output switched on',14:'Bridge discharge permission denied',15:'Bridge discharge permission allowed',
    16:'Low-voltage discharge hold started',17:'Low-voltage discharge hold cleared',18:'Event clock baseline established',
    19:'CAN permission stream inactive',20:'CAN permission stream active'};
  function parseEventHistory(csv,date) {
    const bounds=historyDayBounds(date),lines=csv.replace(/^\uFEFF/,'').split(/\r?\n/);
    if(lines.shift()!=='utc_time,code')throw new Error('Unsupported event CSV header.');
    let invalid=0;if(!csv.endsWith('\n') && lines.length){if(lines.pop().trim())invalid++;}
    const events=[];
    for(const line of lines){
      if(!line.trim())continue;
      const cells=line.split(','),time=Date.parse(cells[0]),code=Number(cells[1]);
      if(cells.length!==2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(cells[0]) ||
        !Number.isFinite(time) || new Date(time).toISOString().replace('.000Z','Z')!==cells[0] ||
        time<bounds.start || time>=bounds.end || !/^\d+$/.test(cells[1]) || !eventNames[code]){invalid++;continue;}
      events.push({time,code,label:eventNames[code]});
    }
    events.sort((a,b)=>a.time-b.time);
    const omitted=Math.max(0,events.length-5000);
    return {date,events:events.slice(-5000),invalid,omitted};
  }
  function clampHistoryView(model,start,end) {
    const span=Math.max(Math.min(15*60000,model.end-model.start),Math.min(model.end-model.start,end-start));
    const from=Math.max(model.start,Math.min(model.end-span,start));
    return {start:from,end:from+span};
  }
  function zoomHistoryView(model,view,factor,anchor) {
    const fraction=Math.max(0,Math.min(1,(anchor-view.start)/(view.end-view.start)));
    const span=Math.max(15*60000,Math.min(model.end-model.start,(view.end-view.start)*factor));
    return clampHistoryView(model,anchor-fraction*span,anchor+(1-fraction)*span);
  }
  function backupDates(from,to){
    historyDayBounds(from);historyDayBounds(to);
    const a=Date.parse(from+'T12:00:00Z'),b=Date.parse(to+'T12:00:00Z');
    if(b<a || b-a>30*86400000)throw new Error('Choose an ordered date range of up to 31 days.');
    const days=[];for(let t=a;t<=b;t+=86400000)days.push(new Date(t).toISOString().slice(0,10));return days;
  }
  // End minute history helpers.
  // Pong stays in this browser: no device requests or persistent scores.
  function newPongMatch() {
    return {player:160,ai:160,x:320,y:160,vx:-240,vy:95,you:0,donut:0,wait:0.6,winner:''};
  }
  function stepPong(s, dt, target, sound=()=>{}) {
    if(s.winner)return;
    dt=Math.max(0,Math.min(dt,0.025));
    const clamp=y=>Math.max(34,Math.min(286,y));
    s.player=clamp(s.player+Math.max(-360*dt,Math.min(360*dt,target-s.player)));
    s.ai=clamp(s.ai+Math.max(-190*dt,Math.min(190*dt,(s.vx>0?s.y:160)-s.ai)));
    if(s.wait>0){s.wait=Math.max(0,s.wait-dt);return;}
    s.x+=s.vx*dt;s.y+=s.vy*dt;
    if(s.y<7){s.y=14-s.y;s.vy=Math.abs(s.vy);sound('wall');}
    if(s.y>313){s.y=626-s.y;s.vy=-Math.abs(s.vy);sound('wall');}
    const hit=(center,direction)=>{
      const angle=Math.max(-1,Math.min(1,(s.y-center)/34))*1.05;
      const speed=Math.min(430,Math.hypot(s.vx,s.vy)+18);
      s.vx=direction*speed*Math.cos(angle);s.vy=speed*Math.sin(angle);
      sound('hit');
    };
    if(s.vx<0 && s.x<=37 && s.x>=20 && Math.abs(s.y-s.player)<=39){s.x=37;hit(s.player,1);}
    if(s.vx>0 && s.x>=603 && s.x<=620 && Math.abs(s.y-s.ai)<=39){s.x=603;hit(s.ai,-1);}
    if(s.x< -7 || s.x>647){
      const playerPoint=s.x>647;
      if(playerPoint)s.you++;else s.donut++;
      if(s.you>=7 || s.donut>=7)s.winner=s.you>=7?'You win!':'Donut wins!';
      sound(s.donut>=7?'meow':playerPoint?'point':'miss');
      s.x=320;s.y=160;s.vx=playerPoint?240:-240;s.vy=(s.you+s.donut)%2?95:-95;s.wait=0.7;
    }
  }
  function createPongAudio(host) {
    const Audio=host.AudioContext || host.webkitAudioContext;
    let audio=null,enabled=true;
    const voices=new Set();
    function stop(){
      for(const voice of voices){try{voice.osc.stop();}catch(_){}voice.osc.disconnect();voice.gain.disconnect();}
      voices.clear();
    }
    return {
      available:!!Audio,
      get enabled(){return enabled;},
      setEnabled(value){enabled=value;if(!enabled)stop();},
      unlock(){
        if(!enabled || !Audio)return;
        try{
          if(!audio)audio=new Audio();
          if(audio.state==='suspended')audio.resume().catch(()=>{});
        }catch(_){/* Audio failure must never interrupt the dashboard or game. */}
      },
      tone(kind){
        if(!enabled || !audio || audio.state!=='running')return;
        try{
          const osc=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;
          const meow=kind==='meow',duration=meow?0.8:kind==='hit'||kind==='wall'?0.055:0.18;
          osc.type=meow?'triangle':'square';
          osc.frequency.setValueAtTime(meow?420:kind==='hit'?520:kind==='wall'?340:kind==='point'?880:220,now);
          if(meow){
            // A cartoon "mee-ow": rise into the vowel, then glide down.
            osc.frequency.exponentialRampToValueAtTime(820,now+0.12);
            osc.frequency.exponentialRampToValueAtTime(640,now+0.32);
            osc.frequency.exponentialRampToValueAtTime(210,now+duration);
          }
          gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(meow?0.075:0.035,now+(meow?0.04:0.004));
          if(meow)gain.gain.linearRampToValueAtTime(0.05,now+0.35);
          gain.gain.exponentialRampToValueAtTime(0.0001,now+duration);
          osc.connect(gain);gain.connect(audio.destination);
          const voice={osc,gain};voices.add(voice);
          osc.onended=()=>{voices.delete(voice);osc.disconnect();gain.disconnect();};
          osc.start(now);osc.stop(now+duration+0.01);
        }catch(_){}
      },
      stop
    };
  }
  function mountPong() {
    const panel=document.createElement('details');
    panel.className='history';panel.id='paw-pong';
    panel.innerHTML=`<summary>Paw Ball · Play against Donut</summary>
      <p class="note">First to 7. Move with your mouse or drag on the court. Keyboard: ↑ / ↓ or W / S while the court is focused.</p>
      <p id="pong-score" role="status" aria-live="polite">You 0 · Donut 0</p>
      <canvas id="pong-court" width="640" height="320" tabindex="0" role="img" aria-label="Paw Ball court. You control the left paddle; Donut controls the right."
        style="display:block;width:100%;max-width:640px;aspect-ratio:2;background:#091820;border:1px solid #38775c;border-radius:12px;touch-action:none">Paw Ball requires a browser with canvas support.</canvas>
      <div class="settings-actions"><button id="pong-play" type="button">Start game</button><button id="pong-reset" type="button">New game</button><button id="pong-sound" type="button" aria-pressed="true">Sound: on</button></div>
      <label style="display:block;margin:12px 0">Game speed: <output id="pong-speed-label">1.0×</output><input id="pong-speed" type="range" min="1" max="3" step="0.25" value="1" aria-label="Paw Ball game speed" style="display:block;width:100%;max-width:400px"></label><p class="note">1× Relaxed · 2× Fast · 3× Wild</p><p class="note">A little fun while the batteries charge.</p>`;
    document.querySelector('main').insertBefore(panel,document.querySelector('footer'));
    const canvas=panel.querySelector('canvas'),ctx=canvas.getContext('2d');
    const play=panel.querySelector('#pong-play'),reset=panel.querySelector('#pong-reset'),score=panel.querySelector('#pong-score');
    const soundButton=panel.querySelector('#pong-sound'),audio=createPongAudio(window);
    const speedControl=panel.querySelector('#pong-speed'),speedLabel=panel.querySelector('#pong-speed-label');
    let gameSpeed=1;
    try{const saved=Number(localStorage.getItem('paw-ball-speed'));if(Number.isFinite(saved)&&saved>=1&&saved<=3)gameSpeed=saved;}catch(_){}
    const showSpeed=()=>{speedControl.value=String(gameSpeed);speedLabel.textContent=gameSpeed.toFixed(2).replace(/0$/,'')+'×';};
    showSpeed();
    speedControl.oninput=()=>{const value=Number(speedControl.value);if(!Number.isFinite(value))return;gameSpeed=Math.max(1,Math.min(3,value));showSpeed();try{localStorage.setItem('paw-ball-speed',String(gameSpeed));}catch(_){}};

    if(!audio.available){soundButton.disabled=true;soundButton.textContent='Sound unavailable';soundButton.setAttribute('aria-pressed','false');}
    soundButton.onclick=()=>{
      audio.setEnabled(!audio.enabled);soundButton.textContent=audio.enabled?'Sound: on':'Sound: off';
      soundButton.setAttribute('aria-pressed',String(audio.enabled));
      if(audio.enabled)audio.unlock();
    };
    if(!ctx){play.disabled=true;reset.disabled=true;score.textContent='Canvas is unavailable in this browser.';return;}
    let state=newPongMatch(),running=false,frame=0,last=0,target=160,keys=new Set(),lastScore='';
    function draw(){
      ctx.fillStyle='#091820';ctx.fillRect(0,0,640,320);
      ctx.strokeStyle='#29434c';ctx.setLineDash([7,9]);ctx.beginPath();ctx.moveTo(320,12);ctx.lineTo(320,308);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='#64e5b0';ctx.fillRect(20,state.player-34,10,68);
      ctx.fillStyle='#f0ba65';ctx.fillRect(610,state.ai-34,10,68);
      ctx.fillStyle='#f4f7fa';ctx.beginPath();ctx.arc(state.x,state.y,7,0,Math.PI*2);ctx.fill();
      const text=`You ${state.you} · Donut ${state.donut}${state.winner?' · '+state.winner:''}`;
      if(text!==lastScore){score.textContent=text;lastScore=text;}
      if(!running || state.winner){
        ctx.fillStyle='rgba(9,24,32,0.8)';ctx.fillRect(120,125,400,70);
        ctx.fillStyle='#f4f7fa';ctx.font='22px system-ui';ctx.textAlign='center';
        ctx.fillText(state.winner || (state.you+state.donut?'Paused':'Ready to play?'),320,168);
      }
    }
    function pause(silence=true){running=false;cancelAnimationFrame(frame);frame=0;keys.clear();if(silence)audio.stop();play.textContent=state.winner?'Play again':'Resume game';draw();}
    function tick(now){
      if(!running)return;
      const elapsed=Math.min(Math.max((now-last)/1000,0),0.05)*gameSpeed;last=now;
      // Small steps prevent fast balls crossing a paddle between frames.
      const steps=Math.max(1,Math.ceil(elapsed/0.008)),dt=elapsed/steps;
      for(let i=0;i<steps;i++){
        if(keys.size)target=state.player+((keys.has('ArrowDown')||keys.has('s')?1:0)-(keys.has('ArrowUp')||keys.has('w')?1:0))*360*dt;
        stepPong(state,dt,target,kind=>audio.tone(kind));
      }
      if(state.winner){pause(false);return;}
      draw();frame=requestAnimationFrame(tick);
    }
    play.onclick=()=>{
      if(running){pause();return;}
      audio.unlock();
      if(state.winner){state=newPongMatch();target=160;}
      running=true;last=performance.now();play.textContent='Pause game';canvas.focus({preventScroll:true});frame=requestAnimationFrame(tick);
    };
    reset.onclick=()=>{pause();state=newPongMatch();target=160;play.textContent='Start game';draw();};
    const point=event=>{const box=canvas.getBoundingClientRect();target=Math.max(34,Math.min(286,(event.clientY-box.top)*320/box.height));};
    canvas.onpointerdown=event=>{event.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);point(event);};
    canvas.onpointermove=event=>{if(event.pointerType==='mouse'||canvas.hasPointerCapture(event.pointerId))point(event);};
    canvas.onpointerup=event=>{if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};
    canvas.onkeydown=event=>{const key=event.key.length===1?event.key.toLowerCase():event.key;if(['ArrowUp','ArrowDown','w','s'].includes(key)){event.preventDefault();keys.add(key);}};
    canvas.onkeyup=event=>{keys.delete(event.key.length===1?event.key.toLowerCase():event.key);};
    canvas.onblur=()=>keys.clear();
    panel.addEventListener('toggle',()=>{if(!panel.open)pause();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
    window.addEventListener('blur',()=>{if(running)pause();});
    draw();
  }
  // Finish charge controls.
  function mountFinishCharge(root) {
    const panel=document.createElement('section');panel.className='preferences-section';panel.style.marginTop='18px';
    panel.innerHTML='<h3>Finish charge</h3><p class="note">Ignore only the SOC charge cutoff for one hour. Voltage and amps settings, temperature holds and fresh-data requirements stay active. The inverter may still stop for its own limits.</p><button type="button" data-finish="start" disabled>Finish charge (1 hour)</button> <button type="button" data-finish="cancel" disabled>Cancel finish</button><p class="note" role="status">Checking finish-charge support…</p>';
    root.appendChild(panel);
    const start=panel.querySelector('[data-finish="start"]'),cancel=panel.querySelector('[data-finish="cancel"]');
    const feedback=panel.querySelector('[role="status"]');
    let saved=null,busy=false,refreshing=false;
    const decode=entity=>{
      const state=JSON.parse(entity.value??entity.state);
      if(typeof state.active!=='boolean'||!Number.isInteger(state.sequence)||
        !Number.isInteger(state.remaining_seconds)||state.remaining_seconds<0||state.remaining_seconds>3600||
        typeof state.message!=='string')throw Error('Invalid finish-charge state.');
      return state;
    };
    const read=async()=>{
      const response=await fetch('/text_sensor/'+encodeURIComponent('Finish Charge State'),
        {credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('Update display firmware to enable finish charge.');
      return decode(await response.json());
    };
    const render=()=>{
      start.disabled=busy||refreshing||!saved||saved.active;
      cancel.disabled=busy||refreshing||!saved||!saved.active;
    };
    async function refresh(){
      if(busy||refreshing||document.hidden||root.open===false)return;
      refreshing=true;render();
      try{saved=await read();feedback.textContent=saved.message;}
      catch(error){saved=null;feedback.textContent=error.message;}
      finally{refreshing=false;render();}
    }
    async function command(begin){
      if(busy||!saved)return;
      busy=true;render();feedback.textContent='Sending request…';
      try{
        const before=await read();
        const response=await fetch('/button/'+encodeURIComponent(begin?'Finish Charge One Hour':'Cancel Finish Charge')+'/press',
          {method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
        if(!response.ok)throw Error('Device request failed: HTTP '+response.status);
        let confirmed=false;
        for(let attempt=0;attempt<12;++attempt){
          await new Promise(resolve=>setTimeout(resolve,300));
          const state=await read();
          if(state.sequence!==before.sequence || (!begin&&!state.active)){
            saved=state;feedback.textContent=state.message;confirmed=true;break;
          }
        }
        if(!confirmed)throw Error('No confirmed state change. Check CAN status before retrying.');
      }catch(error){feedback.textContent=error.message;}
      finally{busy=false;render();}
    }
    start.onclick=()=>command(true);cancel.onclick=()=>command(false);
    setInterval(refresh,30000);refresh();
    root.addEventListener?.('toggle',()=>{if(root.open)refresh();});
    document.addEventListener?.('visibilitychange',()=>{if(!document.hidden)refresh();});
    // Normal updates arrive on the dashboard's existing EventSource connection.
    return entity=>{try{saved=decode(entity);if(!busy)feedback.textContent=saved.message;render();}catch(_){}};
  }
  // End finish charge controls.
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
      .traffic-bar{display:flex;align-items:center;flex:none;gap:5px;margin:0;font-size:10px;color:#93a6b8}.traffic-indicator{display:inline-flex;align-items:center;gap:4px;padding:5px 7px;white-space:nowrap;border:1px solid #263748;border-radius:20px;background:#131e2b;color:#8296a8}.traffic-indicator::before{content:'';width:8px;height:8px;flex:none;border-radius:50%;background:#3b4d5d}.traffic-indicator.active.tx{color:#ffd23f}.traffic-indicator.active.rx{color:#61e4aa}.traffic-indicator.active.tx::before{background:#ffd23f;box-shadow:0 0 7px #ffd23f80}.traffic-indicator.active.rx::before{background:#61e4aa;box-shadow:0 0 7px #61e4aa80}
      .paw-quiet .history,.paw-quiet .traffic-bar,.paw-quiet .catfun{display:none!important}.history-chart-wrap{overflow-x:auto;margin-top:8px}.history-chart{display:block;width:100%;min-width:700px;height:auto}.history-graph-label{font-size:13px;margin-top:16px;color:#cfdae6}.graph-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.graph-controls select,.graph-controls input{background:#131e2b;color:#eff5fc;border:1px solid #536779;border-radius:8px;padding:8px;font:inherit}.graph-summary{font-size:13px;line-height:1.7;margin-top:12px;color:#cfdae6}#history-hover{min-height:30px}
      .panel{background:#131e2be8;border:1px solid #263748;border-radius:24px}.hero{display:grid;grid-template-columns:1fr 1fr;align-items:center;padding:22px;margin-bottom:14px;gap:24px}
      .soc-column{display:flex;flex-direction:column;align-items:center;gap:12px}.ring{width:230px;height:230px;position:relative;margin:auto}.ring svg{width:100%;height:100%;transform:rotate(-90deg)}circle{fill:none;stroke-width:13}.track{stroke:#253747}#arc{stroke:#64e5b0;stroke-linecap:round;transition:stroke-dasharray .7s,stroke .7s}
      .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.percent{font-size:56px;font-weight:650;letter-spacing:-3px}.percent small{font-size:25px;color:#9aafbd;letter-spacing:0}.caption{color:#9aafbd;font-size:13px}
      #mode{color:#64e5b0;font-size:15px;margin-bottom:8px}.big{font-size:42px;font-weight:650;letter-spacing:-1.5px;margin-bottom:6px}.big small{font-size:20px;font-weight:400;color:#9aafbd;letter-spacing:0}
      .bar{height:6px;background:#263748;border-radius:10px;margin:24px 0 10px;overflow:hidden}#fill{height:100%;width:0;background:#64e5b0;transition:width .7s}.runtime{margin-top:16px;padding-top:12px;border-top:1px solid #263748}.runtime strong{font-size:21px;font-weight:600}.runtime p{font-size:12px;line-height:1.6}.labels{display:flex;justify-content:space-between;color:#93a6b8;font-size:12px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.card{padding:18px}.label{color:#93a6b8;font-size:11px;margin-bottom:7px}.value{font-size:27px;font-weight:600;letter-spacing:-1px}.value small{font-size:15px;font-weight:400;color:#93a6b8;letter-spacing:0}.note{font-size:11px;color:#7f94a6;margin-top:9px}
      .energy-panel{margin-top:14px;padding:14px 18px}.energy-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.energy-number{font-size:22px;font-weight:600}.energy-number small{font-size:12px;font-weight:400;color:#93a6b8}.peak{font-size:11px;margin-top:4px;line-height:1.5;color:#93a6b8}.peak.in{color:#64e5b0}.peak.out{color:#ff7979}.energy-number.in{color:#64e5b0}.energy-number.out{color:#ff7979}.energy-heading{font-size:13px;margin-bottom:12px;display:flex;justify-content:space-between;gap:10px}.energy-heading span{font-size:11px;color:#93a6b8}.history{margin-top:12px;border-top:1px solid #263748;padding-top:10px}.history summary{cursor:pointer;color:#a9bbca;font-size:12px}.history-scroll{max-height:230px;overflow:auto;margin-top:10px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:right;padding:8px;border-bottom:1px solid #263748;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{color:#93a6b8}footer{display:flex;justify-content:space-between;gap:12px;margin-top:16px;color:#7f94a6;font-size:12px}.stale .value,.stale .percent,.stale .big{opacity:.45}
      button{background:#64e5b0;color:#10251d;border:0;border-radius:8px;padding:10px 15px;cursor:pointer;font-weight:650}button:disabled{opacity:.45;cursor:wait}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0}.settings-grid label{display:block;font-size:13px;color:#eff5fc}.settings-grid input,.settings-grid select{display:block;width:100%;margin:6px 0;background:#131e2b;border:1px solid #536779;color:#eff5fc;border-radius:8px;padding:10px;font:inherit}.settings-grid small{display:block;font-size:11px;color:#a9bbca;line-height:1.4}.settings-actions{display:flex;gap:10px;flex-wrap:wrap}#settings-message{font-size:13px;line-height:1.5;color:#ffca75}.settings-grid input:focus{outline:2px solid #64e5b0}
      .season-panel{margin-top:14px;padding:12px 18px;display:flex;align-items:center;gap:16px}.season-dial{width:140px;height:108px;flex:none}.season-dial .season-track{fill:none;stroke:#345064;stroke-width:5}.season-dial .season-dot{fill:#64e5b0;stroke:#131e2b;stroke-width:2}.season-dial text{fill:#aec1cf;font:9px system-ui,sans-serif}.season-title{font-size:13px;color:#ffd35c;margin-bottom:5px}.season-count{font-size:18px;font-weight:600}.season-direction{font-size:12px;color:#a9bbca;margin-top:4px}.season-note{font-size:11px;color:#93a6b8;margin-top:5px}.season-info{min-width:0}
      @media(max-width:900px){header{flex-wrap:wrap}.traffic-bar{order:4;flex-basis:100%;justify-content:center;flex-wrap:wrap}#status{margin-left:auto}}
      @media(max-width:650px){main{padding:24px 16px}header{align-items:center;gap:12px}.header-title{order:3;flex-basis:100%}.settings-grid{grid-template-columns:1fr}.hero{grid-template-columns:1fr;padding:25px;gap:22px}.ring{width:225px;height:225px}.grid{grid-template-columns:repeat(2,1fr)}.energy-grid{grid-template-columns:repeat(2,1fr)}.energy-heading{flex-direction:column}.card{padding:20px}.value{font-size:25px}footer{flex-direction:column}.big{font-size:36px}}
    `;
    document.head.append(style);
    document.body.innerHTML = `<main><header><div class="brand"><svg class="brand-mark" viewBox="0 0 64 64" role="img" aria-label="Paw Power logo"><rect x="1" y="1" width="62" height="62" rx="18" fill="#153c31" stroke="#38775c"/><g fill="#64e5b0"><ellipse cx="16" cy="27" rx="5" ry="7" transform="rotate(-25 16 27)"/><ellipse cx="26" cy="18" rx="5" ry="7" transform="rotate(-10 26 18)"/><ellipse cx="39" cy="18" rx="5" ry="7" transform="rotate(10 39 18)"/><ellipse cx="49" cy="27" rx="5" ry="7" transform="rotate(25 49 27)"/><path d="M20 39c4-4 6-10 12-10s8 6 12 10c8 9 2 17-6 14-4-2-8-2-12 0-8 3-14-5-6-14z"/></g><path d="M34 32l-9 13h7l-2 9 11-15h-8z" fill="#123128"/></svg><div class="eyebrow">PAW POWER</div></div><div class="header-title"><h1>Battery monitor</h1><p id="bank-description">51.2V bank · Junctek shunt</p></div><div id="status" role="status">Connecting…</div></header>
      <section class="panel hero"><div class="soc-column"><div class="ring" role="img" aria-label="Battery state of charge"><svg viewBox="0 0 240 240" aria-hidden="true"><circle class="track" cx="120" cy="120" r="100"/><circle id="arc" cx="120" cy="120" r="100" stroke-dasharray="0 628.319"/></svg><div class="center"><div class="percent"><span id="soc">—</span><small>%</small></div><span class="caption">STATE OF CHARGE</span></div></div></div>
      <div><div id="mode">Waiting for shunt</div><div class="big"><span id="hero-power">—</span> <small>W</small></div><p id="flow">Battery power</p><div class="bar"><div id="fill"></div></div><div class="labels"><span id="remaining-label">— Ah remaining</span><span id="total-capacity">— Ah total</span></div><div class="runtime"><div class="label">SHUNT ESTIMATE</div><strong id="shunt-runtime">—</strong><p id="shunt-empty-time">Waiting for shunt estimate</p><div id="runtime-label" class="label" style="margin-top:12px">SMOOTHED ESTIMATE</div><strong id="runtime">—</strong><p id="empty-time">Waiting for discharge readings</p><div class="label" style="margin-top:12px">TIME TO FULL</div><strong id="time-full">—</strong><p id="full-time">Waiting for charge readings</p><p>Steady-rate estimates. Cutoff or charge taper may change timing.</p></div></div></section>
      <section class="grid"><article class="panel card"><div class="label">BATTERY VOLTAGE</div><div class="value"><span id="volts">—</span> <small>V</small></div><div class="note">Measured at shunt</div></article>
      <article class="panel card"><div class="label">BATTERY CURRENT</div><div class="value"><span id="amps">—</span> <small>A</small></div><div class="note">Positive in · Negative out</div></article>
      <article class="panel card"><div class="label">REMAINING CAPACITY</div><div class="value"><span id="ah">—</span> <small>Ah</small></div><div class="note">Shunt capacity counter</div></article>
      <article class="panel card"><div class="label">TEMPERATURE</div><div class="value"><span id="temp">—</span> <small>°F</small></div><div class="note" id="celsius">Battery-mounted probe</div></article>
      <article class="panel card"><div class="label">ENERGY REMAINING</div><div class="value"><span id="energy">—</span> <small>kWh</small></div><div class="note">Estimate at nominal 51.2V</div></article>
      <article class="panel card"><div class="label">DATA AGE</div><div class="value"><span id="age">—</span> <small>s</small></div><div class="note">Since last valid shunt reply</div></article></section>
      <section class="panel energy-panel"><div class="energy-heading">Battery energy<span id="energy-state">Waiting for device clock</span></div><div class="energy-grid"><div><div class="label">TODAY · CHARGED</div><div class="energy-number in"><span id="today-in">—</span> <small>kWh</small></div><div class="peak in" id="today-in-peak">Peak — W · — A</div></div><div><div class="label">TODAY · DISCHARGED</div><div class="energy-number out"><span id="today-out">—</span> <small>kWh</small></div><div class="peak out" id="today-out-peak">Peak — W · — A</div></div><div><div class="label">YESTERDAY · CHARGED</div><div class="energy-number in"><span id="yesterday-in">—</span> <small>kWh</small></div><div class="peak in" id="yesterday-in-peak">Peak — W · — A</div></div><div><div class="label">YESTERDAY · DISCHARGED</div><div class="energy-number out"><span id="yesterday-out">—</span> <small>kWh</small></div><div class="peak out" id="yesterday-out-peak">Peak — W · — A</div></div></div><div class="note" style="margin-top:12px"><strong>Equivalent cycles: <span id="cycle-count">—</span></strong> · <span id="cycle-ah">— Ah discharged</span><br><span id="cycle-details">Waiting for cycle history. Counts begin with this feature.</span></div><details class="history"><summary>Previous 30 days · Michigan time</summary><div class="history-scroll"><table><thead><tr><th>Date</th><th>Charged kWh</th><th>Discharged kWh</th><th>Peak +W</th><th>Peak −W</th><th>Peak +A</th><th>Peak −A</th><th>Coverage</th></tr></thead><tbody id="energy-history"></tbody></table></div><p class="note">Partial = started mid-day, restarted, or missed readings. These are battery totals, not total house use. Peaks are independent maxima from 5-second samples, recorded since this feature was installed; brief spikes may be missed.</p></details></section>
      <section class="panel season-panel" aria-label="Chasing the Sun seasonal cycle"><svg class="season-dial" viewBox="-26 -8 152 116" role="img" aria-label="Annual daylight cycle clockwise: Winter, Spring, Summer, Fall"><circle class="season-track" cx="50" cy="50" r="32"/><text x="50" y="10" text-anchor="middle">SUMMER</text><text x="50" y="98" text-anchor="middle">WINTER</text><text x="8" y="53" text-anchor="end">SPRING</text><text x="92" y="53" text-anchor="start">FALL</text><circle id="season-marker" class="season-dot" cx="50" cy="82" r="5"/></svg><div class="season-info"><div class="season-title">Chasing the Sun</div><div id="season-count" class="season-count">Waiting for date…</div><div id="season-direction" class="season-direction"></div><div class="season-note">Northern hemisphere · Calendar guide: Jun 21 / Dec 21 · Not a solar forecast</div></div></section>
      <details class="history"><summary>Disconnects · Shunt <span id="shunt-drops">—</span> / Webpage <span id="web-drops">0</span> today</summary><p class="note" id="shunt-last-drop">Shunt: waiting for history</p><p class="note" id="web-last-drop">Webpage: no drops recorded</p><div class="history-scroll"><table><thead><tr><th>Date</th><th>Shunt drops</th><th>Offline</th><th>Webpage drops</th><th>Offline</th></tr></thead><tbody id="disconnect-history"></tbody></table></div><p class="note">Shunt: no valid reply for 20 seconds. Webpage: event-stream error or 15 seconds without events. Each outage counts once. Webpage records belong to this browser; closed-page time and ESP32 downtime are not measured. Michigan dates.</p></details><details class="history"><summary>CAN output · Pylontech</summary><p class="note">500 kbps · Pylontech · <span id="can-state">Waiting for state</span></p><p class="note" id="can-output-status">Waiting for CAN status</p><button id="can-toggle" type="button">Enable CAN output</button><p class="note">Enables after 3 fresh shunt replies. Pauses on stale data and resumes automatically. Last on/off choice is saved. <span id="can-soc-rules">SOC rules: waiting for settings.</span></p></details><details class="history" id="battery-settings"><summary>Battery settings · Saved on device</summary><p class="note">48V LiFePO₄ profiles only. Match these limits to your battery and inverter specifications. Editing does nothing until Apply saves the complete profile. First installation or protection upgrade requires a reviewed Apply before CAN can run. Existing inverter limits still apply.</p><form id="settings-form"><fieldset id="settings-fields" disabled style="border:0;padding:0;margin:0"><div class="settings-grid" id="settings-grid"></div><div class="settings-actions"><button type="submit" id="settings-apply">Apply &amp; save to flash</button><button type="button" id="settings-reload">Reload saved values</button></div></fieldset></form><p id="settings-message" role="status" aria-live="polite">Waiting for device settings…</p><p class="note">SOC is calculated from remaining Ah / configured capacity. This does not recalibrate or reprogram the Junctek shunt. A 100% SOC stop still requires suitable voltage limits. Hold voltage is advertised while charging is disabled; it is not an active float stage. Current limits are bank totals, not per battery. Temperature protection blocks charging only. At startup or after rejected/stale readings, each enabled protection must reach its resume threshold. Place the probe on a representative battery.</p></details><details class="history"><summary>Device memory</summary><p class="note">Free heap: <span id="heap-free">—</span> KiB · Largest free block: <span id="heap-block">—</span> KiB · Max loop interval: <span id="loop-ms">—</span> ms</p><p class="note">Live working memory, not firmware size or CPU utilization. Bluetooth disabled.</p></details><footer><span>Local monitor · Refreshes every 5 seconds</span><span id="updated">Waiting for live data</span><small>Shunt webpage · v2026.11.22.1</small></footer></main>`;
    const $ = id => document.getElementById(id);
    // Reuse the header paw as a self-contained browser-tab icon.
    const tabPaw=document.querySelector('.brand-mark').cloneNode(true);
    tabPaw.querySelector('rect').remove();
    tabPaw.setAttribute('xmlns','http://www.w3.org/2000/svg');
    tabPaw.setAttribute('width','64');tabPaw.setAttribute('height','64');
    document.querySelectorAll('link[rel~="icon"]').forEach(icon=>icon.remove());
    const favicon=document.createElement('link');
    favicon.rel='icon';favicon.type='image/svg+xml';favicon.sizes='any';
    favicon.href='data:image/svg+xml,'+encodeURIComponent(tabPaw.outerHTML);
    document.head.append(favicon);
    mountPong();
    const preferences=document.createElement('details');
    preferences.id='paw-preferences';
    preferences.className='panel';
    preferences.style.cssText='padding:18px;margin-top:14px';
    preferences.innerHTML='<summary style="cursor:pointer;font-size:17px;font-weight:650">Preferences</summary>' +
      '<p class="note">Display settings are saved locally. Notification rules are shared with Android through your server.</p>' +
      '<section style="margin-top:18px"><h3 style="font-size:14px">Cloud connection</h3>' +
      '<button id="cloud-uploads-toggle" type="button" role="switch" aria-checked="false" aria-describedby="cloud-uploads-feedback" disabled>Cloud Uploads: Checking…</button>' +
      '<p class="note">Uploads readings to your server. When off, Android keeps the last readings and marks them stale.</p>' +
      '<p id="cloud-uploads-feedback" class="note" role="status" aria-live="polite"></p></section>';
    const main=document.querySelector('main');
    main.insertBefore(preferences,main.querySelector('footer'));
    const canSection=$('can-toggle').closest('details');
    canSection.className='preferences-section';
    canSection.style.marginTop='18px';
    preferences.appendChild(canSection);
    const receiveFinishCharge=mountFinishCharge(preferences);
    import('/paw/common.js?v=7').then(() => {
      const errorRoot=document.createElement('section');
      document.querySelector('main').insertBefore(errorRoot,document.querySelector('main > footer'));
      globalThis.PawPowerCommon.mountErrorLog(errorRoot,'PawPower-Shunt');
      globalThis.PawPowerCommon.mountDevicePreferences(preferences);
      globalThis.PawPowerCommon.mountAlertPreferences(preferences);
      globalThis.PawPowerCommon.mountEquipmentPreferences(preferences,'pawpower');
      globalThis.PawPowerCommon.mountNotificationTest();
    }).catch(() => {
      const message = document.createElement('p');
      message.className = 'note';
      message.textContent = 'Phone notification controls could not load. Update the display firmware and refresh this page.';
      const main = document.querySelector('main');
      main.insertBefore(message, main.querySelector('footer'));
    });
    const quietButton=document.createElement('button');quietButton.id='quiet-toggle';quietButton.type='button';
    quietButton.title='Hide settings, diagnostics and cat extras; keep live readings and graphs.';
    document.querySelector('header').appendChild(quietButton);
    function setQuietView(quiet){
      document.body.classList.toggle('paw-quiet',quiet);quietButton.textContent=quiet?'Full dashboard':'Quiet dashboard';
      quietButton.setAttribute('aria-pressed',String(quiet));
      try{localStorage.setItem('paw-quiet-view-v1',quiet?'1':'0');}catch(_){}
    }
    let initialQuiet=false;try{initialQuiet=localStorage.getItem('paw-quiet-view-v1')==='1';}catch(_){}
    setQuietView(initialQuiet);
    quietButton.onclick=()=>setQuietView(!document.body.classList.contains('paw-quiet'));

    function receiveCycles(data){
      let value;try{value=JSON.parse(data.state);}catch(_){return;}
      if(!value || ![value.cycles,value.discharged_ah,value.hours,value.started,value.gaps].every(Number.isFinite) ||
        value.cycles<0 || value.discharged_ah<0 || value.hours<0 || value.started<0 || value.gaps<0)return;
      $('cycle-count').textContent=value.cycles.toLocaleString(undefined,{minimumFractionDigits:3,maximumFractionDigits:3});
      $('cycle-ah').textContent=value.discharged_ah.toLocaleString(undefined,{maximumFractionDigits:1})+' Ah discharged';
      const since=value.started?new Date(value.started*1000).toLocaleDateString():'clock not yet synchronized';
      $('cycle-details').textContent=`Recorded discharge ÷ configured Ah capacity · Tracking since ${since} · ${value.hours.toFixed(1)} h observed · ${value.gaps} skipped gaps. Saves every 5 minutes; not a battery age or health estimate.`;
    }
    // Optional screen setting, announced only by touchscreen firmware.
    const screenPanel=document.createElement('details');
    screenPanel.className='preferences-section';screenPanel.hidden=true;
    screenPanel.innerHTML=`<summary>LCD screen</summary><p class="note">Timeout after the last touch. 0 = Never. Saved on the display.</p><div class="settings-actions"><label for="screen-timeout">Screen timeout (minutes)</label><input id="screen-timeout" type="number" min="0" max="120" step="1" value="15" style="width:90px"><button id="screen-timeout-save" type="button">Save timeout</button></div><p id="screen-timeout-message" class="note" role="status"></p>`;
    preferences.appendChild(screenPanel);
    let screenTimeoutSaved=null,screenTimeoutDirty=false,screenTimeoutPending=false;
    const timeoutInput=$('screen-timeout'),timeoutSave=$('screen-timeout-save'),timeoutMessage=$('screen-timeout-message');
    function timeoutValue(data){
      const value=typeof data.value==='number'?data.value:parseFloat(data.state);
      return Number.isInteger(value)&&value>=0&&value<=120?value:null;
    }
    function receiveScreenTimeout(data){
      const value=timeoutValue(data);if(value===null)return;
      screenPanel.hidden=false;screenTimeoutSaved=value;
      if(!screenTimeoutDirty && !screenTimeoutPending)timeoutInput.value=String(value);
      if(!screenTimeoutDirty && !screenTimeoutPending)timeoutMessage.textContent=value===0?'Saved: Never':'Saved: '+value+' minutes';
    }
    timeoutInput.oninput=()=>{screenTimeoutDirty=true;timeoutMessage.textContent='Unsaved timeout';};
    timeoutSave.onclick=async()=>{
      if(screenTimeoutPending || screenTimeoutSaved===null)return;
      if(!transport){timeoutMessage.textContent='Device offline; timeout not saved.';return;}
      if(new URLSearchParams(location.search).has('demo')){timeoutMessage.textContent='Preview only; timeout not saved.';return;}
      const value=Number(timeoutInput.value);
      if(timeoutInput.value.trim()==='' || !Number.isInteger(value)||value<0||value>120){timeoutMessage.textContent='Enter whole minutes from 0 to 120 (0 = Never).';return;}
      screenTimeoutPending=true;timeoutInput.disabled=true;timeoutSave.disabled=true;
      timeoutMessage.textContent='Saving timeout…';
      try{
        const endpoint='/number/'+encodeURIComponent('Screen Timeout Minutes');
        const response=await fetch(endpoint+'/set?value='+encodeURIComponent(value),{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
        if(!response.ok)throw new Error('Timeout save request failed.');
        const check=await fetch(endpoint,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000)});
        if(!check.ok || timeoutValue(await check.json())!==value)throw new Error('Timeout save could not be confirmed.');
        screenTimeoutSaved=value;screenTimeoutDirty=false;timeoutInput.value=String(value);
        timeoutMessage.textContent=value===0?'Saved: Never':'Saved: '+value+' minutes';
      }catch(error){timeoutMessage.textContent=error.message;}
      finally{screenTimeoutPending=false;timeoutInput.disabled=false;timeoutSave.disabled=false;}
    };
    // End optional screen setting.
    // Outgoing CAN permission bits, independent of measured battery flow.
    const permissionBar=document.createElement('div');
    permissionBar.style.cssText='text-align:center;font-size:13px';
    permissionBar.setAttribute('aria-label','Outgoing inverter permissions');
    permissionBar.innerHTML=`<div style="display:flex;flex-direction:column;gap:6px" role="status" aria-live="polite"><span id="can-charge-permission">CAN charge: Waiting</span><span id="can-discharge-permission">CAN discharge: Waiting</span></div>`;
    document.querySelector('.soc-column').appendChild(permissionBar);
    function clearCanPermissions(text='Unavailable'){
      ['charge','discharge'].forEach(kind=>{const node=$('can-'+kind+'-permission');node.textContent=`CAN ${kind}: ${text}`;node.style.color='#93a6b8';});
    }
    function receiveCanPermissions(data){
      let state;try{state=JSON.parse(data.state);}catch(_){clearCanPermissions();return;}
      if(!state || typeof state.active!=='boolean' || (state.active && (typeof state.charge!=='boolean'||typeof state.discharge!=='boolean'))){clearCanPermissions();return;}
      if(!state.active){clearCanPermissions('Not sending');return;}
      ['charge','discharge'].forEach(kind=>{
        const node=$('can-'+kind+'-permission');node.textContent=`CAN ${kind}: ${state[kind]?'Allowed':'Blocked'}`;
        node.style.color=state[kind]?'#64e5b0':'#ffca75';
      });
    }
    // End CAN permission indicators.
    // Web traffic indicators use event sequences, independent of screen blink latches.
    const trafficBar = document.createElement('section');
    trafficBar.className = 'traffic-bar';
    trafficBar.setAttribute('aria-label', 'RS485 and CAN traffic activity');
    trafficBar.innerHTML = `<span id="traffic-0" class="traffic-indicator tx" title="Outgoing RS485 bytes">RS485 TX</span>
      <span id="traffic-1" class="traffic-indicator rx" title="Incoming RS485 bytes, including invalid replies">RS485 RX</span>
      <span id="traffic-2" class="traffic-indicator tx" title="CAN controller reports successful transmission">CAN TX</span>
      <span id="traffic-3" class="traffic-indicator rx" title="Received CAN frames">CAN RX</span>`;
    document.querySelector('header').insertBefore(trafficBar, $('status'));
    let trafficState = null;
    const trafficTimers = [null, null, null, null];
    function clearTraffic() {
      trafficState = null;
      trafficTimers.forEach((timer, i) => {
        if (timer !== null) clearTimeout(timer);
        trafficTimers[i] = null; $('traffic-' + i).classList.remove('active');
      });
    }
    function receiveTraffic(data) {
      let next; try { next = JSON.parse(data.state); } catch (_) { return; }
      const uint = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
      if (!uint(next.boot) || !Array.isArray(next.counts) || next.counts.length !== 4 || !next.counts.every(uint)) return;
      // Retained state on initial connection/reboot is a baseline, not new traffic.
      if (!trafficState || next.boot !== trafficState.boot) {
        clearTraffic(); trafficState = next;
      } else {
        next.counts.forEach((count, i) => {
          if (count === trafficState.counts[i]) return;
          if (trafficTimers[i] !== null) clearTimeout(trafficTimers[i]);
          $('traffic-' + i).classList.add('active');
          trafficTimers[i] = setTimeout(() => {
            $('traffic-' + i).classList.remove('active'); trafficTimers[i] = null;
          }, 500);
        });
        trafficState = next;
      }
    }
    // Display firmware announces this optional panel through its SD entity.
    const sdPanel = document.createElement('details');
    sdPanel.className = 'history'; sdPanel.hidden = true;
    sdPanel.innerHTML = `<summary>SD card · Files and diagnostics</summary>
      <p id="sd-status" class="note" role="status" aria-live="polite">Waiting for card status</p>
      <div class="settings-actions"><button id="sd-refresh" type="button">Refresh file list</button>
      <button id="sd-test" type="button">Run write/read test</button></div>
      <p id="sd-space" class="note">Partition space not yet measured</p>
      <p id="sd-recording" class="note" role="status">Waiting for minute recording status</p>
      <div class="settings-actions"><label for="sd-log-date">Daily CSV</label>
      <input id="sd-log-date" type="date"><button id="sd-download" type="button" disabled>Download CSV</button></div>
      <p id="sd-download-status" class="note" role="status"></p>
      <p class="note">Root directory only, up to 32 entries. The test creates a new temporary file, verifies it, then removes it. Existing files are preserved. No automatic formatting. Power off before removing or inserting the card.</p>
      <div class="history-scroll"><table><thead><tr><th>Name</th><th>Type</th><th>Bytes</th></tr></thead><tbody id="sd-files"></tbody></table></div>
      <details><summary>Back up history as ZIP</summary>
      <div class="graph-controls"><label for="backup-from">From</label><input id="backup-from" type="date"><label for="backup-to">To</label><input id="backup-to" type="date">
      <button id="backup-start" type="button" disabled>Download history ZIP</button><button id="backup-cancel" type="button" disabled>Cancel backup</button></div>
      <p id="backup-status" class="note" role="status">Up to 31 days per ZIP. The ESP32 compresses and streams one archive containing minute CSVs, event CSVs and a report. Keep this tab open.</p>
      <p class="note">Read-only; nothing is erased. Missing days are listed in the report. Today may be partial. Maximum 32 MiB of source CSVs. Cancelled or failed downloads are discarded. No passwords, firmware or configuration are included.</p></details>
      <details><summary>Erase SD card files…</summary>
      <p class="note">Permanently deletes ALL files and folders in the mounted SD partition, including logs. Other partitions remain. This cannot be undone. Keep power on until the operation finishes.</p>
      <label for="sd-erase-confirm">Type ERASE to confirm</label>
      <input id="sd-erase-confirm" type="text" maxlength="5" autocomplete="off" spellcheck="false">
      <button id="sd-erase" type="button" disabled style="background:#ff7979">Erase SD card files</button>
      <button id="sd-erase-cancel" type="button">Cancel</button></details>`;
    document.querySelector('main').insertBefore(sdPanel, document.querySelector('main > footer'));
    const graphPanel = document.createElement('details');
    graphPanel.open = true;
    graphPanel.className = 'panel energy-panel'; graphPanel.hidden = true;
    graphPanel.innerHTML = `<summary style="cursor:pointer;font-weight:650">Battery history graphs <span class="note">Daily SD records · Michigan time</span></summary>
      <div class="graph-controls"><label for="history-date">Day</label><input id="history-date" type="date">
      <button id="history-load" type="button" disabled>Show / refresh graphs</button><button id="event-load" type="button" disabled>Load / refresh events</button>
      <label for="history-extra">Extra graph</label><select id="history-extra"><option value="volts">Voltage</option><option value="temp">Temperature (°F)</option></select></div>
      <div class="graph-controls" style="margin-top:10px" aria-label="Graph zoom and pan">
      <button id="history-1h" type="button">1h</button><button id="history-6h" type="button">6h</button><button id="history-day" type="button">Full day</button>
      <button id="history-zoom-in" type="button" aria-label="Zoom in">+</button><button id="history-zoom-out" type="button" aria-label="Zoom out">−</button>
      <button id="history-earlier" type="button">← Earlier</button><button id="history-later" type="button">Later →</button>
      <span id="history-range" class="note" role="status">Load a day to zoom.</span></div>
      <p id="history-load-status" class="note" role="status">Choose a day to load its recorded history.</p>
      <div id="history-summary" class="graph-summary"></div>
      <div class="history-graph-label">Battery power (kW) · Green charging / red discharging</div>
      <div class="history-chart-wrap"><svg id="history-power" class="history-chart" viewBox="0 0 900 230" tabindex="0" role="img" aria-label="Daily battery power. Use left and right arrows to inspect minutes."></svg></div>
      <div class="history-graph-label">State of charge (%)</div>
      <div class="history-chart-wrap"><svg id="history-soc" class="history-chart" viewBox="0 0 900 230" tabindex="0" role="img" aria-label="Daily battery SOC. Use left and right arrows to inspect minutes."></svg></div>
      <div class="history-graph-label" id="history-extra-label">Battery voltage (V)</div>
      <div class="history-chart-wrap"><svg id="history-extra-plot" class="history-chart" viewBox="0 0 900 230" tabindex="0" role="img" aria-label="Additional daily battery readings. Use left and right arrows to inspect minutes."></svg></div>
      <p id="history-hover" class="note"></p>
      <details class="history" open><summary>Event timeline</summary>
      <p id="event-load-status" class="note" role="status">Events start with this firmware. Load a day to inspect.</p>
      <div class="history-scroll"><table><thead><tr><th>Time</th><th>Event</th></tr></thead><tbody id="event-history"></tbody></table></div>
      <p class="note">Click an event to zoom to a 30-minute window around it. Yellow markers show saved events (up to the latest 200 markers). These are bridge observations, not inverter acknowledgements. Threshold events require validated shunt recovery. Startup time is when the clock first becomes available; events before clock synchronization or during a power outage cannot be reconstructed.</p></details>
      <p class="note">Solid lines join consecutive complete minutes. Dots show partial or isolated records. Missing and unrecorded periods are gaps. Move or tap to inspect. Scroll the mouse wheel to zoom; drag to pan; pinch with two fingers to zoom. Arrow keys inspect minutes, Shift+arrows pan, and +/− zoom. Minimum window: 15 minutes. Use Show / refresh graphs for the latest records.</p>`;
    document.querySelector('main').insertBefore(graphPanel, document.querySelector('main > .season-panel').nextSibling);
    const treatPanel=document.createElement('section');
    treatPanel.className='panel energy-panel catfun';
    treatPanel.innerHTML=`<div class="energy-heading">🐾 Treats powered by sunshine <span>Charging-energy equivalent</span></div>
      <div class="energy-grid"><div><div class="label">TODAY</div><div class="energy-number in" id="treat-today">—</div></div>
      <div><div class="label">RECORDED DAYS</div><div class="energy-number in" id="treat-total">—</div></div></div>
      <p id="treat-coverage" class="note">Waiting for recorded charging totals.</p>
      <details><summary>Treat economics</summary><form id="treat-settings" class="graph-controls" style="margin-top:10px">
      <label for="treat-rate">Electricity ($/kWh)</label><input id="treat-rate" type="number" min="0" step="any" required value="0.25" style="width:100px">
      <label for="treat-price">Price per treat ($)</label><input id="treat-price" type="number" min="0" step="any" required placeholder="Enter price" style="width:100px">
      <button type="submit">Save prices</button></form><p id="treat-message" class="note" role="status">Enter your price per treat. Prices save in this browser only.</p></details>
      <p class="note">Charged kWh × electricity price ÷ treat price. A fun value equivalent, not measured savings or total solar production: battery charging can include AC power and energy later lost. Recorded days are the device’s available history, not a lifetime counter.</p>`;
    document.querySelector('main').insertBefore(treatPanel,$('paw-pong'));
    let treatPrices=null;
    try {
      const saved=JSON.parse(localStorage.getItem('paw-treat-prices-v1'));
      if(saved && treatEquivalent(1,saved.rate,saved.price)!==null) {
        treatPrices=saved;$('treat-rate').value=String(saved.rate);$('treat-price').value=String(saved.price);
        $('treat-message').textContent='Prices loaded from this browser.';
      }
    } catch(_) {}
    function renderTreats(history) {
      const valid=(history?.clock && Array.isArray(history.days))?history.days.filter(d=>!d.missing && Number.isFinite(d.in) && d.in>=0):[];
      const today=valid.find(d=>d.date===michiganDate(Date.now()));
      const format=kwh=>{
        const n=treatPrices && treatEquivalent(kwh,treatPrices.rate,treatPrices.price);
        return n===null || n===false || !Number.isFinite(n)?'—':n.toLocaleString(undefined,{maximumFractionDigits:1})+' treats';
      };
      $('treat-today').textContent=today?format(today.in):'—';
      $('treat-total').textContent=valid.length?format(valid.reduce((sum,d)=>sum+d.in,0)):'—';
      $('treat-coverage').textContent=valid.length?`${valid.length} recorded day${valid.length===1?'':'s'} · ${valid.filter(d=>d.partial).length} partial · ${valid.reduce((sum,d)=>sum+d.in,0).toFixed(2)} kWh charged`+(today?.partial?' · Today is partial':''):'Waiting for recorded charging totals.';
    }
    $('treat-settings').onsubmit=event=>{
      event.preventDefault();
      const rate=$('treat-rate').value.trim(),price=$('treat-price').value.trim();
      if(!rate || !price || treatEquivalent(1,Number(rate),Number(price))===null) {
        $('treat-message').textContent='Use an electricity price of zero or more and a treat price greater than zero.';return;
      }
      treatPrices={rate:Number(rate),price:Number(price)};
      try {localStorage.setItem('paw-treat-prices-v1',JSON.stringify(treatPrices));$('treat-message').textContent='Prices saved in this browser.';}
      catch(_) {$('treat-message').textContent='Prices applied for this visit; browser storage is unavailable.';}
      renderTreats(historyPayload);
    };
    let eventModel=null;
    function renderEvents(model){
      eventModel=model;const body=$('event-history');body.textContent='';
      const timeFormat=new Intl.DateTimeFormat('en-US',{timeZone:'America/Detroit',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'});
      for(const event of [...model.events].reverse()){
        const row=document.createElement('tr');
        const when=document.createElement('td');when.textContent=timeFormat.format(new Date(event.time));row.appendChild(when);
        const cell=document.createElement('td'),button=document.createElement('button');
        button.type='button';button.textContent=event.label;button.title='Zoom graphs to 30 minutes around this event';
        button.onclick=()=>zoomToEvent(event,model.date);cell.appendChild(button);row.appendChild(cell);
        body.appendChild(row);
      }
      $('event-load-status').textContent=`${model.date} · ${model.events.length} saved events`+(model.invalid?` · ${model.invalid} invalid rows skipped`:'')+(model.omitted?` · ${model.omitted} older rows omitted`:'');
      if(historyModel && historyModel.date===model.date)renderHistoryGraphs(historyModel);
    }
    async function zoomToEvent(event,date){
      if(!historyModel || historyModel.date!==date)await loadDailyCsv(date,true);
      if(!historyModel || historyModel.date!==date){$('event-load-status').textContent='Event saved, but minute graphs are unavailable or busy for this day. Try again after loading its graphs.';return;}
      setHistoryView(event.time-15*60000,event.time+15*60000);
      inspectHistory(historyModel,event.time);
      $('history-hover').textContent+=' · '+event.label;
      $('history-power').scrollIntoView?.({behavior:'smooth',block:'center'});
      $('history-power').focus?.({preventScroll:true});
    }
    let historyModel = null, historyCursor = 0, historyView=null, viewDate=null;
    const graphGestures={};
    function redrawHistoryView(){
      if(!historyModel)return;
      renderHistoryPlot(historyModel,'watts');renderHistoryPlot(historyModel,'soc');renderHistoryPlot(historyModel,$('history-extra').value);
      $('history-range').textContent=historyTime(historyView.start)+' – '+historyTime(historyView.end);
      for(const [id,hours] of [['history-1h',1],['history-6h',6],['history-day',null]]){
        $(id).disabled=false;$(id).setAttribute('aria-pressed',String(hours===null?historyView.end-historyView.start===historyModel.end-historyModel.start:Math.abs(historyView.end-historyView.start-hours*3600000)<1));
      }
      $('history-earlier').disabled=historyView.start<=historyModel.start;
      $('history-later').disabled=historyView.end>=historyModel.end;
      $('history-zoom-in').disabled=historyView.end-historyView.start<=15*60000;
      $('history-zoom-out').disabled=historyView.end-historyView.start>=historyModel.end-historyModel.start;
      const selected=historyModel.start+historyCursor*60000;
      if(selected>=historyView.start && selected<historyView.end)inspectHistory(historyModel,selected);
    }
    function setHistoryView(start,end){
      if(!historyModel)return;
      historyView=clampHistoryView(historyModel,start,end);redrawHistoryView();
    }
    function zoomHistory(factor,anchor){
      if(!historyModel || !historyView)return;
      const next=zoomHistoryView(historyModel,historyView,factor,anchor??(historyView.start+historyView.end)/2);
      setHistoryView(next.start,next.end);
    }
    function panHistory(direction){
      if(!historyModel || !historyView)return;
      const delta=(historyView.end-historyView.start)*0.5*direction;
      setHistoryView(historyView.start+delta,historyView.end+delta);
    }
    function presetHistory(hours){
      if(!historyModel)return;
      if(hours===null){setHistoryView(historyModel.start,historyModel.end);return;}
      const full=historyView.end-historyView.start>=historyModel.end-historyModel.start;
      const latest=historyModel.rows.filter(r=>r.valid).at(-1)?.time;
      const center=full && Number.isFinite(latest)?latest:(historyView.start+historyView.end)/2;
      setHistoryView(center-hours*1800000,center+hours*1800000);
    }
    for(const [id,action] of [['history-1h',()=>presetHistory(1)],['history-6h',()=>presetHistory(6)],['history-day',()=>presetHistory(null)],
      ['history-zoom-in',()=>zoomHistory(0.5)],['history-zoom-out',()=>zoomHistory(2)],['history-earlier',()=>panHistory(-1)],['history-later',()=>panHistory(1)]]){
      $(id).disabled=true;$(id).onclick=action;
    }
    const historyTimeFormatter = new Intl.DateTimeFormat('en-US', {timeZone:'America/Detroit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'});
    const historyTime = ms => historyTimeFormatter.format(new Date(ms));
    function renderHistoryPlot(model, key) {
      const svg = $(key==='watts' ? 'history-power' : key==='soc' ? 'history-soc' : 'history-extra-plot');
      const valueOf=r=>key==='temp'?r.temp*9/5+32:r[key];
      const left=65, right=880, top=16, bottom=193;
      const view=historyView||model,span=view.end-view.start;
      let limit=100;
      if (key==='watts') {
        const maximum = model.rows.reduce((n,r)=>r.valid?Math.max(n,Math.abs(r.watts)):n,1000);
        const magnitude=10**Math.floor(Math.log10(maximum));
        limit=[1,2,5,10].find(n=>n*magnitude>=maximum)*magnitude;
      }
      let min=key==='watts'?-limit:0, max=limit;
      if(key==='volts' || key==='temp') {
        let lo=Infinity,hi=-Infinity;
        for(const r of model.rows) if(r.valid && Number.isFinite(r[key])) {lo=Math.min(lo,valueOf(r));hi=Math.max(hi,valueOf(r));}
        if(!Number.isFinite(lo)){lo=key==='temp'?32:48;hi=key==='temp'?100:58;}
        const pad=Math.max(key==='temp'?1:0.1,(hi-lo)*0.1);
        min=Math.floor((lo-pad)*10)/10;max=Math.ceil((hi+pad)*10)/10;
      }
      const x=time=>left+(time+30000-view.start)/span*(right-left);
      const y=value=>bottom-(value-min)/(max-min)*(bottom-top);
      const number = n => n.toFixed(2);
      let markup='';
      for (let i=0;i<5;++i) {
        const value=min+(max-min)*i/4, at=y(value);
        const label=key==='watts'?(value/1000).toFixed(1).replace(/\.0$/,''):key==='soc'?String(value)+'%':value.toFixed(1);
        markup+=`<line x1="${left}" x2="${right}" y1="${number(at)}" y2="${number(at)}" stroke="#2b3b4b"/><text x="${left-10}" y="${number(at+4)}" fill="#a9bbca" font-size="13" text-anchor="end">${label}</text>`;
        const time=view.start+span*i/4, px=left+(right-left)*i/4;
        markup+=`<text x="${number(px)}" y="218" fill="#a9bbca" font-size="12" text-anchor="${i===0?'start':i===4?'end':'middle'}">${historyTime(time)}</text>`;
      }
      const clip='history-viewport-'+key;
      markup+=`<defs><clipPath id="${clip}"><rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}"/></clipPath></defs><g clip-path="url(#${clip})">`;
      const runs=historyRuns(model,key);
      const path=runs.filter(run=>run.length>1).map(run=>run.map((r,i)=>`${i?'L':'M'}${number(x(r.time))},${number(y(valueOf(r)))}`).join(' ')).join(' ');
      if(key==='watts') {
        const zero=y(0);
        markup+=`<defs><clipPath id="history-positive"><rect x="${left}" y="${top}" width="${right-left}" height="${zero-top}"/></clipPath><clipPath id="history-negative"><rect x="${left}" y="${zero}" width="${right-left}" height="${bottom-zero}"/></clipPath></defs>
          <path d="${path}" fill="none" stroke="#61e4aa" stroke-width="2" clip-path="url(#history-positive)"/><path d="${path}" fill="none" stroke="#ff7979" stroke-width="2" clip-path="url(#history-negative)"/>`;
      } else markup+=`<path d="${path}" fill="none" stroke="#7ab6ff" stroke-width="2"/>`;
      for(const run of runs) if(run.length===1) {
        const r=run[0], color=key==='watts'?(r.watts>0?'#61e4aa':r.watts<0?'#ff7979':'#93a6b8'):'#7ab6ff';
        markup+=`<circle cx="${number(x(r.time))}" cy="${number(y(valueOf(r)))}" r="3" fill="${color}" stroke="${r.complete?color:'#ffd23f'}" stroke-width="1.5"/>`;
      }
      if(!runs.length)markup+='<text x="460" y="100" fill="#a9bbca" font-size="16" text-anchor="middle">No readings for this graph in this file</text>';
      markup+=`<line id="${key==='watts'?'history-power-cursor':key==='soc'?'history-soc-cursor':'history-extra-cursor'}" x1="${left}" x2="${left}" y1="${top}" y2="${bottom}" stroke="#cfdae6" stroke-dasharray="3 4" visibility="hidden" pointer-events="none"/>`;
      if(eventModel?.date===model.date)for(const event of eventModel.events.filter(e=>e.time>=view.start && e.time<view.end).slice(-200)) {
        const at=left+(event.time-view.start)/span*(right-left);
        markup+=`<line x1="${number(at)}" x2="${number(at)}" y1="${top}" y2="${bottom}" stroke="#ffd23f" stroke-opacity="0.5" stroke-dasharray="2 4"><title>${event.label}</title></line>`;
      }
      svg.innerHTML=markup+'</g>';
      svg.style.touchAction='none';svg.style.cursor='grab';
      const gesture=graphGestures[key]||(graphGestures[key]={points:new Map(),base:null});
      const fraction=clientX=>{
        const box=svg.getBoundingClientRect(),position=(clientX-box.left)/box.width*900;
        return Math.max(0,Math.min(1,(position-left)/(right-left)));
      };
      const resetBase=()=>{
        const points=[...gesture.points.values()];
        gesture.base=points.length?{view:{...historyView},x:points.reduce((a,b)=>a+b,0)/points.length,
          distance:points.length>=2?Math.abs(points[1]-points[0]):0}:null;
      };
      svg.onpointerdown=event=>{
        if(event.pointerType==='mouse' && event.button!==0)return;
        event.preventDefault();svg.setPointerCapture(event.pointerId);
        gesture.points.set(event.pointerId,event.clientX);resetBase();
        inspectHistory(model,historyView.start+fraction(event.clientX)*(historyView.end-historyView.start));
      };
      svg.onpointermove=event=>{
        if(!gesture.points.has(event.pointerId)){
          if(!gesture.points.size)inspectHistory(model,historyView.start+fraction(event.clientX)*(historyView.end-historyView.start));
          return;
        }
        gesture.points.set(event.pointerId,event.clientX);
        const points=[...gesture.points.values()],base=gesture.base;
        if(!base)return;
        const current=points.reduce((a,b)=>a+b,0)/points.length;
        const originalSpan=base.view.end-base.view.start;
        const width=svg.getBoundingClientRect().width*(right-left)/900;
        if(points.length>=2 && base.distance>2){
          const distance=Math.max(2,Math.abs(points[1]-points[0]));
          const next=zoomHistoryView(model,base.view,base.distance/distance,base.view.start+fraction(base.x)*originalSpan);
          const delta=(base.x-current)/width*(next.end-next.start);
          setHistoryView(next.start+delta,next.end+delta);
        }else if(points.length===1){
          const delta=(base.x-current)/width*originalSpan;
          setHistoryView(base.view.start+delta,base.view.end+delta);
        }
      };
      const endPointer=event=>{
        if(!gesture.points.delete(event.pointerId))return;
        if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);
        resetBase();
      };
      svg.onpointerup=endPointer;svg.onpointercancel=endPointer;svg.onlostpointercapture=endPointer;
      svg.onwheel=event=>{
        event.preventDefault();
        const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?500:1);
        zoomHistory(Math.exp(Math.max(-1,Math.min(1,delta*0.002))),historyView.start+fraction(event.clientX)*(historyView.end-historyView.start));
      };
      svg.onkeydown=event=>{
        if(['+','=','-','_'].includes(event.key)){event.preventDefault();zoomHistory(event.key==='+'||event.key==='='?0.5:2);return;}
        if(event.shiftKey && ['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();panHistory(event.key==='ArrowLeft'?-1:1);return;}
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();
        const first=Math.max(0,Math.ceil((view.start-model.start)/60000)),last=Math.min(Math.round((model.end-model.start)/60000)-1,Math.ceil((view.end-model.start)/60000)-1);
        historyCursor=event.key==='Home'?first:event.key==='End'?last:Math.max(first,Math.min(last,historyCursor+(event.key==='ArrowRight'?1:-1)));
        inspectHistory(model,model.start+historyCursor*60000);
      };
    }
    function inspectHistory(model,time) {
      const count=Math.round((model.end-model.start)/60000);
      historyCursor=Math.max(0,Math.min(count-1,Math.floor((time-model.start)/60000)));
      const at=model.start+historyCursor*60000, row=model.byTime.get(at);
      const view=historyView||model;
      const x=65+(at+30000-view.start)/(view.end-view.start)*815;
      for(const id of ['history-power-cursor','history-soc-cursor','history-extra-cursor']) {
        $(id).setAttribute('x1',x.toFixed(2));$(id).setAttribute('x2',x.toFixed(2));$(id).setAttribute('visibility',x>=65&&x<=880?'visible':'hidden');
      }
      $('history-hover').textContent=historyTime(at)+' · '+(!row?'No record':!row.valid?'Missing readings':
        `${(row.watts/1000).toFixed(2)} kW · ${row.soc.toFixed(1)}% SOC · ${row.volts.toFixed(2)} V · ${Number.isFinite(row.temp)?(row.temp*9/5+32).toFixed(1)+' °F':'Temperature not recorded'} · ${row.coverage.toFixed(1)} s covered · ${row.quality.replaceAll('_',' ')}`);
    }
    function renderHistoryGraphs(model) {
      if(viewDate!==model.date){
        historyView={start:model.start,end:model.end};viewDate=model.date;historyCursor=0;
        for(const gesture of Object.values(graphGestures)){gesture.points.clear();gesture.base=null;}
      }
      historyModel=model;
      const energy=model.validCount?`${(model.chargedWh/1000).toFixed(3)} kWh charged / ${(model.dischargedWh/1000).toFixed(3)} kWh discharged`:'No measured energy';
      $('history-summary').textContent=`${model.date} · Recorded energy: ${energy} · ${(model.coverage/3600).toFixed(2)} h covered in a ${(model.end-model.start)/3600000} h day · ${model.partialCount} partial / ${model.missingCount} missing rows`+
        (model.invalid?` · ${model.invalid} invalid rows skipped`:'')+(model.duplicates?` · ${model.duplicates} duplicate minutes replaced`:'');
      redrawHistoryView();
      if(model.rows.length && historyView.start===model.start && historyView.end===model.end)inspectHistory(model,model.rows.find(r=>r.valid)?.time ?? model.rows[0].time);
    }
    $('history-extra').onchange=()=>{
      $('history-extra-label').textContent=$('history-extra').value==='temp'?'Battery temperature (°F)':'Battery voltage (V)';
      if(historyModel)renderHistoryPlot(historyModel,$('history-extra').value);
    };
    let backupActive=false,backupController=null;
    let sdState = null;
    let sdRequestPending = false;
    let sdDownloadActive = false;
    function updateSdButtons() {
      const busy = !sdState || sdState.busy || sdRequestPending || sdDownloadActive || backupActive;
      $('backup-start').disabled=!!busy || !sdState.mounted;
      $('backup-cancel').disabled=!backupActive;
      $('backup-from').disabled=backupActive;$('backup-to').disabled=backupActive;
      $('sd-refresh').disabled = !!busy;
      $('sd-test').disabled = !!busy || !sdState.mounted;
      $('sd-erase-confirm').disabled = !!busy || !sdState.mounted;
      $('sd-erase').disabled = !!busy || !sdState.mounted || $('sd-erase-confirm').value !== 'ERASE';
      $('sd-download').disabled = !!busy || !sdState.mounted;
      $('history-load').disabled = !!busy || !sdState.mounted;
      $('event-load').disabled = !!busy || !sdState.mounted;
      $('history-date').disabled = sdDownloadActive;
    }
    function receiveSd(data) {
      let state; try { state = JSON.parse(data.state); } catch (_) { return; }
      if (!Array.isArray(state.files)) return;
      if (!sdState || state.revision !== sdState.revision) sdRequestPending = false;
      sdState = state; sdPanel.hidden = false; graphPanel.hidden = false;
      $('sd-status').textContent = (state.busy ? 'Working… ' : '') + String(state.message || '') +
        (state.mounted ? ` · ${Number(state.capacity_mb || 0).toLocaleString()} MiB card` : '') +
        (state.truncated ? ' · Listing limited to the first 32 entries or size limit' : '');
      updateSdButtons();
      const mib = value => (value / 1048576).toLocaleString(undefined, {maximumFractionDigits:1});
      $('sd-space').textContent = Number.isFinite(state.total_bytes) && Number.isFinite(state.free_bytes) ?
        `Mounted partition: ${mib(state.total_bytes - state.free_bytes)} MiB used · ${mib(state.free_bytes)} MiB free · ${mib(state.total_bytes)} MiB total` :
        'Mounted partition space unavailable';
      $('sd-recording').textContent = String(state.logging || 'Recording status unavailable') +
        ` · ${Number(state.rows_written || 0)} rows saved since restart · ${Number(state.dropped_minutes || 0)} minutes not saved`+
        (Number.isFinite(state.event_rows)?` · Events: ${state.event_rows} saved / ${state.event_dropped||0} not saved since restart`: ': Event recorder not announced')+
        (state.event_logging?' · '+String(state.event_logging):'');
      const rows = state.files.map(file => {
        const row = document.createElement('tr');
        for (const value of [file.name, file.directory ? 'Folder' : 'File', file.directory ? '—' : file.bytes ?? 'Unknown']) {
          const cell = document.createElement('td'); cell.textContent = String(value); row.appendChild(cell);
        }
        return row;
      });
      if (!rows.length) {
        const row = document.createElement('tr'), cell = document.createElement('td');
        cell.colSpan = 3; cell.textContent = state.mounted ? 'No root entries listed' : 'Card unavailable';
        row.appendChild(cell); rows.push(row);
      }
      $('sd-files').replaceChildren(...rows);
    }
    async function sdAction(writeTest, erase = false) {
      if (!sdState || sdState.busy || sdRequestPending || sdDownloadActive || backupActive || !transport) return;
      if (erase && (!sdState.mounted || $('sd-erase-confirm').value !== 'ERASE')) return;
      sdRequestPending = true;
      if (erase) $('sd-erase-confirm').value = '';
      updateSdButtons();
      $('sd-status').textContent = erase ? 'Erasing SD card files… Keep power on.' : writeTest ? 'Requesting write/read test…' : 'Requesting file list…';
      try {
        const name = writeTest ? 'SD Card Write Test' : 'SD Card Refresh';
        const url = erase ? '/text/' + encodeURIComponent('SD Card Erase') + '/set?value=ERASE' :
          '/button/' + encodeURIComponent(name) + '/press';
        const response = await fetch(url,
          {method:'POST', credentials:'same-origin', signal:AbortSignal.timeout(5000)});
        if (!response.ok) throw new Error('HTTP ' + response.status);
      } catch (error) {
        $('sd-status').textContent = 'SD request failed: ' + error.message;
        sdRequestPending = false; updateSdButtons();
      }
    }
    $('sd-refresh').onclick = () => sdAction(false);
    $('sd-test').onclick = () => sdAction(true);
    $('sd-erase-confirm').oninput = updateSdButtons;
    $('sd-erase').onclick = () => sdAction(false, true);
    $('sd-erase-cancel').onclick = () => { $('sd-erase-confirm').value = ''; updateSdButtons(); };
    $('sd-log-date').value = michiganDate(Date.now());
    async function loadDailyCsv(date, graph = false, events = false) {
      if (!sdState || !sdState.mounted || sdState.busy || sdRequestPending || sdDownloadActive || backupActive || !transport) return;
      const status = $(events?'event-load-status':graph?'history-load-status':'sd-download-status');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { status.textContent = 'Choose a date.'; return; }
      if(events){eventModel=null;$('event-history').textContent='';if(historyModel)renderHistoryGraphs(historyModel);}
      if(graph) {
        historyModel=null;
        for(const id of ['history-power','history-soc','history-extra-plot']) {
          const svg=$(id);svg.innerHTML='';svg.onpointermove=null;svg.onpointerdown=null;svg.onkeydown=null;
        }
        $('history-summary').textContent='';$('history-hover').textContent='';
      }
      status.textContent='Loading '+date+'…';
      sdDownloadActive = true; updateSdButtons();
      const token = Date.now().toString(16) + Math.floor(Math.random()*0xffffffff).toString(16);
      const parts = []; let offset = 0, limit = null, missingEventFile = false;
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      try {
        while (limit === null || offset < limit) {
          let chunk = null;
          for (let retry=0; retry<30 && !chunk; ++retry) {
              const command = (events?'E:':'') + date + '|' + offset + '|' + token;
            const response = await fetch('/text/' + encodeURIComponent('SD Log Read') + '/set?value=' + encodeURIComponent(command),
              {method:'POST', credentials:'same-origin', signal:AbortSignal.timeout(5000)});
            if (!response.ok) throw new Error('HTTP ' + response.status);
            await pause(100);
            const check = await fetch('/text_sensor/' + encodeURIComponent('SD Card Diagnostics'),
              {credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(5000)});
            if (!check.ok) throw new Error('HTTP ' + check.status);
            const data = await check.json(), state = JSON.parse(data.state);
            receiveSd(data);
            if (state.export && state.export.token === token && state.export.date === date && state.export.offset === offset) chunk = state.export;
          }
          if (!chunk) throw new Error('Card busy or download response timed out. Try again.');
          if (chunk.error) throw new Error(chunk.error);
          if (events && chunk.missing === true) missingEventFile = true;
          if (!Number.isInteger(chunk.size) || chunk.size < 1 || chunk.size > 1048576 || typeof chunk.data !== 'string') throw new Error('Invalid CSV response');
          if (limit === null) limit = chunk.size;
          if (!chunk.data.length || chunk.size < limit) throw new Error('CSV changed during download. Try again.');
          const part = chunk.data.slice(0, limit-offset);
          parts.push(part); offset += part.length;
          status.textContent = `Loading ${date}: ${offset.toLocaleString()} / ${limit.toLocaleString()} bytes`;
        }
        if(events) {
          renderEvents(parseEventHistory(parts.join(''),date));
          if (missingEventFile) status.textContent = `${date} · No event log recorded for this date. Event files are created when an event is saved.`;
        } else if(graph) {
          renderHistoryGraphs(parseMinuteHistory(parts.join(''),date));
          status.textContent='Loaded '+date+' · Snapshot from SD card';
        } else {
          const url = URL.createObjectURL(new Blob(parts, {type:'text/csv;charset=utf-8'}));
          const link = document.createElement('a'); link.href = url; link.download = 'PawPower-' + date + '.csv';
          document.body.appendChild(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          status.textContent = 'Downloaded PawPower-' + date + '.csv';
        }
      } catch (error) { status.textContent = (events?'Events unavailable: ':graph?'Graph load failed: ':'Download failed: ') + error.message; }
      finally { sdDownloadActive = false; updateSdButtons(); }
    }
    const backupToday=michiganDate(Date.now());
    $('backup-to').value=backupToday;
    $('backup-from').value=new Date(Date.parse(backupToday+'T12:00:00Z')-6*86400000).toISOString().slice(0,10);
    $('backup-cancel').onclick=()=>{
      if(!backupActive)return;
      backupController?.abort();
      fetch('/paw/history-cancel',{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(5000)}).catch(()=>{});
      $('backup-status').textContent='Cancelling ZIP download…';
    };
    $('backup-start').onclick=async()=>{
      if(backupActive || sdDownloadActive || !sdState?.mounted || sdState.busy || !transport)return;
      let dates;try{dates=backupDates($('backup-from').value,$('backup-to').value);}catch(error){$('backup-status').textContent=error.message;return;}
      backupActive=true;backupController=new AbortController();updateSdButtons();
      $('backup-status').textContent='Requesting compressed ZIP from ESP32…';
      try{
        const url='/paw/history.zip?'+new URLSearchParams({from:dates[0],to:dates.at(-1)});
        const response=await fetch(url,{credentials:'same-origin',signal:backupController.signal,cache:'no-store'});
        if(!response.ok)throw new Error('HTTP '+response.status+': '+(await response.text()).slice(0,250));
        if(!response.headers.get('content-type')?.startsWith('application/zip'))throw new Error('Device did not return a ZIP. Update the complete shared folder and recompile.');
        const reader=response.body.getReader(),parts=[];let bytes=0;
        try{
          for(;;){const {done,value}=await reader.read();if(done)break;
            bytes+=value.byteLength;if(bytes>40*1048576){await reader.cancel();throw new Error('Compressed download exceeds browser limit; select fewer days.');}
            parts.push(value);$('backup-status').textContent='Receiving ESP32-compressed ZIP: '+(bytes/1024).toFixed(1)+' KiB';
          }
        }finally{reader.releaseLock();}
        const download=URL.createObjectURL(new Blob(parts,{type:'application/zip'})),link=document.createElement('a');
        link.href=download;link.download='PawPower-History-'+dates[0]+'-to-'+dates.at(-1)+'.zip';
        document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(download),1000);
        $('backup-status').textContent='Compressed ZIP downloaded · '+(bytes/1024).toFixed(1)+' KiB. See backup-report.json for missing files.';
      }catch(error){
        backupController.abort();
        $('backup-status').textContent=error.name==='AbortError'?'Backup cancelled; incomplete download discarded.':'ZIP backup failed: '+error.message;
      }finally{backupActive=false;backupController=null;updateSdButtons();}
    };
    $('sd-download').onclick = () => loadDailyCsv($('sd-log-date').value);
    $('history-date').value = michiganDate(Date.now());
    $('history-load').onclick = async () => {const date=$('history-date').value;await loadDailyCsv(date,true);await loadDailyCsv(date,false,true);};
    $('event-load').onclick = () => loadDailyCsv($('history-date').value,false,true);
    let seasonDate = '';
    setInterval(() => renderSeason(), 60000);
    function renderSeason() {
      const date = michiganDate(Date.now());
      if (date === seasonDate) return;
      const cycle = seasonalCycle(date);
      if (!cycle) return;
      seasonDate = date;
      $('season-count').textContent = cycle.event || `About ${cycle.days} days until ${cycle.target} solstice`;
      $('season-direction').textContent = cycle.decreasing ? 'Daylight decreasing · Shortest day ahead' : 'Daylight increasing · Longer days ahead';
      $('season-marker').setAttribute('cx', cycle.x.toFixed(2));
      $('season-marker').setAttribute('cy', cycle.y.toFixed(2));
    }

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
      ['Hot charging resume','°F',null,null,0.1,'Resumes at or below this temperature; must be lower than stop.'],
      ['Stop discharging at','%',0,99,0.1,'Disables discharge at or below this SOC. Voltage cutoff remains a backup.'],
      ['Resume discharging at','%',1,100,0.1,'Discharge resumes at or above this SOC; at least 1% above stop.']
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
      $('bank-description').textContent=`51.2V bank · Junctek shunt · ${capacity.toLocaleString()}Ah`;
      $('total-capacity').textContent=`${capacity.toLocaleString()} Ah total`;
      $('can-soc-rules').textContent=`Charging SOC hold: stop ${next.values[1]}%, resume ${next.values[2]}%. Discharge SOC: stop ${next.values[16]}%, resume ${next.values[17]}%. Cold protection: ${next.values[10] ? `stop ≤${next.values[11]}°F, resume ≥${next.values[12]}°F` : 'disabled'}. Hot protection: ${next.values[13] ? `stop ≥${next.values[14]}°F, resume ≤${next.values[15]}°F` : 'disabled'}.`;
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
      else if(draft[17]<draft[16]+1)error='Discharge resume SOC must be at least 1% above stop SOC.';
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
    let historyPayload = null, historyAt = 0, historyBusy = false, historyError = false;
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
      clearCanPermissions('Offline');
      clearTraffic();
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
      if (normalized.endsWith('battery_cycle_history')) {receiveCycles(data);return;}
      if (normalized.endsWith('bus_traffic_activity')) {receiveTraffic(data);return;}
      if (normalized.endsWith('finish_charge_state')) {receiveFinishCharge(data);return;}
      if (normalized.endsWith('can_permissions')) {receiveCanPermissions(data);return;}
      if (normalized.endsWith('screen_timeout_minutes')) {receiveScreenTimeout(data);return;}
      if (normalized.endsWith('sd_card_diagnostics')) {receiveSd(data);return;}
      if (normalized.endsWith('battery_settings_state')) {receiveSettings(data);return;}
      if (normalized.endsWith('can_output_status')) {
        $('can-output-status').textContent=String(data.state || 'Waiting for CAN status');return;
      }
      if (normalized.endsWith('can_bench_output')) {
        canEnabled = data.value === true || data.value === 1 || String(data.state).toUpperCase() === 'ON';
        if(!canEnabled)clearCanPermissions('Not sending');
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
      renderTreats(history);
      if (!history) { $('energy-state').textContent = historyError ? 'History unavailable · retrying' : 'Loading daily totals…'; return; }
      if (!history.clock) { $('energy-state').textContent = 'Waiting for device clock'; return; }
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
      const stale = !transport || Date.now()-historyAt>75000 || !(age>=0 && age<20);
      $('energy-state').textContent=historyError?'Saved totals · History unavailable · retrying':stale?'Saved totals · Monitoring paused':days[0]?.partial?'Today partial · Counts on ESP32':'Live · Counts on ESP32';
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
      renderSeason();
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
    async function readEnergyHistory() {
      if(historyBusy || document.hidden)return;
      historyBusy=true;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
      try {
        const response=await fetch('/paw/energy-history',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        if(!response.ok)throw Error('History unavailable');
        const history=await response.json();
        if(!history || typeof history.clock!=='boolean' || !Array.isArray(history.days) || history.days.length>31)throw Error('Invalid history');
        for(const day of history.days) {
          if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || (!day.missing && !['in','out','hours'].every(k=>Number.isFinite(day[k]))))throw Error('Invalid history day');
        }
        historyPayload=history;historyAt=Date.now();historyError=false;
      } catch(_) {historyError=true;}
      finally {clearTimeout(timer);historyBusy=false;renderEnergy();}
    }
    connect();setInterval(connectionTick,1000);setInterval(readEnergyHistory,30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)readEnergyHistory();});
    readEnergyHistory();render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
