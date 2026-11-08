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
      x: 50+32*Math.sin(angle), y: 50+32*Math.cos(angle) };
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
    if (lines.shift() !== header) throw new Error('Unsupported battery history CSV header.');
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
      if (cells.length !== 10 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(cells[0]) ||
          !Number.isFinite(time) || new Date(time).toISOString().replace('.000Z','Z') !== cells[0] ||
          !Number.isFinite(coverage) || coverage<0 || coverage>62 || !qualities.has(cells[3])) {invalid++;continue;}
      if (time<bounds.start || time>=bounds.end) {invalid++;continue;}
      const numbers = cells.slice(4).map(v => v.trim()==='' ? null : Number(v));
      const missing = cells[3]==='missing';
      if ((missing && (coverage!==0 || numbers.some(v=>v!==null))) ||
          (!missing && (coverage<=0 || numbers.some(v=>v===null || !Number.isFinite(v) || Math.abs(v)>1e9) ||
           numbers[0]<0 || numbers[0]>100 || numbers[4]<0 || numbers[5]<0))) {invalid++;continue;}
      const row = {time,coverage,quality:cells[3],valid:!missing,soc:numbers[0],watts:numbers[3],
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
  function historyRuns(model) {
    const runs = []; let run = [];
    for (const row of model.rows) {
      if (!row.valid) {if(run.length)runs.push(run);run=[];continue;}
      if (!row.complete) {if(run.length)runs.push(run);runs.push([row]);run=[];continue;}
      if (run.length && row.time-run[run.length-1].time!==60000) {runs.push(run);run=[];}
      run.push(row);
    }
    if(run.length)runs.push(run);
    return runs;
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
    panel.innerHTML=`<summary>Paw Pong · Play against Donut</summary>
      <p class="note">First to 7. Move with your mouse or drag on the court. Keyboard: ↑ / ↓ or W / S while the court is focused.</p>
      <p id="pong-score" role="status" aria-live="polite">You 0 · Donut 0</p>
      <canvas id="pong-court" width="640" height="320" tabindex="0" role="img" aria-label="Pong court. You control the left paddle; Donut controls the right."
        style="display:block;width:100%;max-width:640px;aspect-ratio:2;background:#091820;border:1px solid #38775c;border-radius:12px;touch-action:none">Pong requires a browser with canvas support.</canvas>
      <div class="settings-actions"><button id="pong-play" type="button">Start game</button><button id="pong-reset" type="button">New game</button><button id="pong-sound" type="button" aria-pressed="true">Sound: on</button></div>
      <p class="note">A little fun while the batteries charge.</p>`;
    document.querySelector('main').insertBefore(panel,document.querySelector('footer'));
    const canvas=panel.querySelector('canvas'),ctx=canvas.getContext('2d');
    const play=panel.querySelector('#pong-play'),reset=panel.querySelector('#pong-reset'),score=panel.querySelector('#pong-score');
    const soundButton=panel.querySelector('#pong-sound'),audio=createPongAudio(window);
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
      const elapsed=Math.min(Math.max((now-last)/1000,0),0.05);last=now;
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
      .traffic-bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 14px;font-size:11px;color:#93a6b8}.traffic-indicator{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid #263748;border-radius:20px;background:#131e2b;color:#8296a8}.traffic-indicator::before{content:'';width:8px;height:8px;flex:none;border-radius:50%;background:#3b4d5d}.traffic-indicator.active.tx{color:#ffd23f}.traffic-indicator.active.rx{color:#61e4aa}.traffic-indicator.active.tx::before{background:#ffd23f;box-shadow:0 0 7px #ffd23f80}.traffic-indicator.active.rx::before{background:#61e4aa;box-shadow:0 0 7px #61e4aa80}
      .history-chart-wrap{overflow-x:auto;margin-top:8px}.history-chart{display:block;width:100%;min-width:700px;height:auto}.history-graph-label{font-size:13px;margin-top:16px;color:#cfdae6}.graph-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.graph-controls input{background:#131e2b;color:#eff5fc;border:1px solid #536779;border-radius:8px;padding:8px;font:inherit}.graph-summary{font-size:13px;line-height:1.7;margin-top:12px;color:#cfdae6}#history-hover{min-height:30px}
      .panel{background:#131e2be8;border:1px solid #263748;border-radius:24px}.hero{display:grid;grid-template-columns:1fr 1fr;align-items:center;padding:22px;margin-bottom:14px;gap:24px}
      .ring{width:230px;height:230px;position:relative;margin:auto}.ring svg{width:100%;height:100%;transform:rotate(-90deg)}circle{fill:none;stroke-width:13}.track{stroke:#253747}#arc{stroke:#64e5b0;stroke-linecap:round;transition:stroke-dasharray .7s,stroke .7s}
      .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.percent{font-size:56px;font-weight:650;letter-spacing:-3px}.percent small{font-size:25px;color:#9aafbd;letter-spacing:0}.caption{color:#9aafbd;font-size:13px}
      #mode{color:#64e5b0;font-size:15px;margin-bottom:8px}.big{font-size:42px;font-weight:650;letter-spacing:-1.5px;margin-bottom:6px}.big small{font-size:20px;font-weight:400;color:#9aafbd;letter-spacing:0}
      .bar{height:6px;background:#263748;border-radius:10px;margin:24px 0 10px;overflow:hidden}#fill{height:100%;width:0;background:#64e5b0;transition:width .7s}.runtime{margin-top:16px;padding-top:12px;border-top:1px solid #263748}.runtime strong{font-size:21px;font-weight:600}.runtime p{font-size:12px;line-height:1.6}.labels{display:flex;justify-content:space-between;color:#93a6b8;font-size:12px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.card{padding:18px}.label{color:#93a6b8;font-size:11px;margin-bottom:7px}.value{font-size:27px;font-weight:600;letter-spacing:-1px}.value small{font-size:15px;font-weight:400;color:#93a6b8;letter-spacing:0}.note{font-size:11px;color:#7f94a6;margin-top:9px}
      .energy-panel{margin-top:14px;padding:14px 18px}.energy-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.energy-number{font-size:22px;font-weight:600}.energy-number small{font-size:12px;font-weight:400;color:#93a6b8}.peak{font-size:11px;margin-top:4px;line-height:1.5;color:#93a6b8}.peak.in{color:#64e5b0}.peak.out{color:#ff7979}.energy-number.in{color:#64e5b0}.energy-number.out{color:#ff7979}.energy-heading{font-size:13px;margin-bottom:12px;display:flex;justify-content:space-between;gap:10px}.energy-heading span{font-size:11px;color:#93a6b8}.history{margin-top:12px;border-top:1px solid #263748;padding-top:10px}.history summary{cursor:pointer;color:#a9bbca;font-size:12px}.history-scroll{max-height:230px;overflow:auto;margin-top:10px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:right;padding:8px;border-bottom:1px solid #263748;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{color:#93a6b8}footer{display:flex;justify-content:space-between;gap:12px;margin-top:16px;color:#7f94a6;font-size:12px}.stale .value,.stale .percent,.stale .big{opacity:.45}
      button{background:#64e5b0;color:#10251d;border:0;border-radius:8px;padding:10px 15px;cursor:pointer;font-weight:650}button:disabled{opacity:.45;cursor:wait}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0}.settings-grid label{display:block;font-size:13px;color:#eff5fc}.settings-grid input,.settings-grid select{display:block;width:100%;margin:6px 0;background:#131e2b;border:1px solid #536779;color:#eff5fc;border-radius:8px;padding:10px;font:inherit}.settings-grid small{display:block;font-size:11px;color:#a9bbca;line-height:1.4}.settings-actions{display:flex;gap:10px;flex-wrap:wrap}#settings-message{font-size:13px;line-height:1.5;color:#ffca75}.settings-grid input:focus{outline:2px solid #64e5b0}
      .season-panel{margin-top:14px;padding:12px 18px;display:flex;align-items:center;gap:16px}.season-dial{width:88px;height:88px;flex:none}.season-dial .season-track{fill:none;stroke:#345064;stroke-width:5}.season-dial .season-dot{fill:#64e5b0;stroke:#131e2b;stroke-width:2}.season-dial text{fill:#aec1cf;font:9px system-ui,sans-serif}.season-title{font-size:13px;color:#ffd35c;margin-bottom:5px}.season-count{font-size:18px;font-weight:600}.season-direction{font-size:12px;color:#a9bbca;margin-top:4px}.season-note{font-size:11px;color:#93a6b8;margin-top:5px}.season-info{min-width:0}
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
      <section class="panel season-panel" aria-label="Chasing the Sun seasonal cycle"><svg class="season-dial" viewBox="0 0 100 100" role="img" aria-label="Annual daylight cycle: summer at top, winter at bottom"><circle class="season-track" cx="50" cy="50" r="32"/><text x="50" y="10" text-anchor="middle">SUMMER</text><text x="50" y="98" text-anchor="middle">WINTER</text><circle id="season-marker" class="season-dot" cx="50" cy="82" r="5"/></svg><div class="season-info"><div class="season-title">Chasing the Sun</div><div id="season-count" class="season-count">Waiting for date…</div><div id="season-direction" class="season-direction"></div><div class="season-note">Northern hemisphere · Calendar guide: Jun 21 / Dec 21 · Not a solar forecast</div></div></section>
      <details class="history"><summary>Disconnects · Shunt <span id="shunt-drops">—</span> / Webpage <span id="web-drops">0</span> today</summary><p class="note" id="shunt-last-drop">Shunt: waiting for history</p><p class="note" id="web-last-drop">Webpage: no drops recorded</p><div class="history-scroll"><table><thead><tr><th>Date</th><th>Shunt drops</th><th>Offline</th><th>Webpage drops</th><th>Offline</th></tr></thead><tbody id="disconnect-history"></tbody></table></div><p class="note">Shunt: no valid reply for 20 seconds. Webpage: event-stream error or 15 seconds without events. Each outage counts once. Webpage records belong to this browser; closed-page time and ESP32 downtime are not measured. Michigan dates.</p></details><details class="history"><summary>CAN output · Pylontech</summary><p class="note">500 kbps · Pylontech · <span id="can-state">Waiting for state</span></p><p class="note" id="can-output-status">Waiting for CAN status</p><button id="can-toggle" type="button">Enable CAN output</button><p class="note">Enables after 3 fresh shunt replies. Pauses on stale data and resumes automatically. Last on/off choice is saved. <span id="can-soc-rules">SOC rules: waiting for settings.</span></p></details><details class="history" id="battery-settings"><summary>Battery settings · Saved on device</summary><p class="note">48V LiFePO₄ profiles only. Match these limits to your battery and inverter specifications. Editing does nothing until Apply saves the complete profile. First installation or protection upgrade requires a reviewed Apply before CAN can run. Existing inverter limits still apply.</p><form id="settings-form"><fieldset id="settings-fields" disabled style="border:0;padding:0;margin:0"><div class="settings-grid" id="settings-grid"></div><div class="settings-actions"><button type="submit" id="settings-apply">Apply &amp; save to flash</button><button type="button" id="settings-reload">Reload saved values</button></div></fieldset></form><p id="settings-message" role="status" aria-live="polite">Waiting for device settings…</p><p class="note">SOC is calculated from remaining Ah / configured capacity. This does not recalibrate or reprogram the Junctek shunt. A 100% SOC stop still requires suitable voltage limits. Hold voltage is advertised while charging is disabled; it is not an active float stage. Current limits are bank totals, not per battery. Temperature protection blocks charging only. At startup or after rejected/stale readings, each enabled protection must reach its resume threshold. Place the probe on a representative battery.</p></details><details class="history"><summary>Device memory</summary><p class="note">Free heap: <span id="heap-free">—</span> KiB · Largest free block: <span id="heap-block">—</span> KiB · Max loop interval: <span id="loop-ms">—</span> ms</p><p class="note">Live working memory, not firmware size or CPU utilization. Bluetooth disabled.</p></details><footer><span>Local monitor · Refreshes every 5 seconds</span><span id="updated">Waiting for live data</span></footer></main>`;
    const $ = id => document.getElementById(id);
    mountPong();
    // Web traffic indicators use event sequences, independent of screen blink latches.
    const trafficBar = document.createElement('section');
    trafficBar.className = 'traffic-bar';
    trafficBar.setAttribute('aria-label', 'RS485 and CAN traffic activity');
    trafficBar.innerHTML = `<span id="traffic-caption">Bus traffic · waiting for device</span>
      <span id="traffic-0" class="traffic-indicator tx" title="Outgoing RS485 bytes">RS485 TX</span>
      <span id="traffic-1" class="traffic-indicator rx" title="Incoming RS485 bytes, including invalid replies">RS485 RX</span>
      <span id="traffic-2" class="traffic-indicator tx" title="CAN controller reports successful transmission">CAN TX</span>
      <span id="traffic-3" class="traffic-indicator rx" title="Received CAN frames">CAN RX</span>`;
    document.querySelector('main').insertBefore(trafficBar, document.querySelector('main > .hero'));
    let trafficState = null;
    const trafficTimers = [null, null, null, null];
    function clearTraffic() {
      trafficState = null;
      trafficTimers.forEach((timer, i) => {
        if (timer !== null) clearTimeout(timer);
        trafficTimers[i] = null; $('traffic-' + i).classList.remove('active');
      });
      $('traffic-caption').textContent = 'Bus traffic · disconnected';
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
      $('traffic-caption').textContent = 'Bus traffic · TX amber / RX green';
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
      <details><summary>Erase SD card files…</summary>
      <p class="note">Permanently deletes ALL files and folders in the mounted SD partition, including logs. Other partitions remain. This cannot be undone. Keep power on until the operation finishes.</p>
      <label for="sd-erase-confirm">Type ERASE to confirm</label>
      <input id="sd-erase-confirm" type="text" maxlength="5" autocomplete="off" spellcheck="false">
      <button id="sd-erase" type="button" disabled style="background:#ff7979">Erase SD card files</button>
      <button id="sd-erase-cancel" type="button">Cancel</button></details>`;
    document.querySelector('main').insertBefore(sdPanel, document.querySelector('main > footer'));
    const graphPanel = document.createElement('section');
    graphPanel.className = 'panel energy-panel'; graphPanel.hidden = true;
    graphPanel.innerHTML = `<div class="energy-heading">Battery history graphs <span>Daily SD records · Michigan time</span></div>
      <div class="graph-controls"><label for="history-date">Day</label><input id="history-date" type="date">
      <button id="history-load" type="button" disabled>Show / refresh graphs</button></div>
      <p id="history-load-status" class="note" role="status">Choose a day to load its recorded history.</p>
      <div id="history-summary" class="graph-summary"></div>
      <div class="history-graph-label">Battery power (kW) · Green charging / red discharging</div>
      <div class="history-chart-wrap"><svg id="history-power" class="history-chart" viewBox="0 0 900 230" tabindex="0" role="img" aria-label="Daily battery power. Use left and right arrows to inspect minutes."></svg></div>
      <div class="history-graph-label">State of charge (%)</div>
      <div class="history-chart-wrap"><svg id="history-soc" class="history-chart" viewBox="0 0 900 230" tabindex="0" role="img" aria-label="Daily battery SOC. Use left and right arrows to inspect minutes."></svg></div>
      <p id="history-hover" class="note"></p>
      <p class="note">Solid lines join consecutive complete minutes. Dots show partial or isolated records. Missing and unrecorded periods are gaps. Move over a graph, tap it, or use arrow keys to inspect. Scroll charts sideways on small screens. Use Show / refresh graphs for the latest records.</p>`;
    document.querySelector('main').insertBefore(graphPanel, document.querySelector('main > .season-panel'));
    let historyModel = null, historyCursor = 0;
    const historyTimeFormatter = new Intl.DateTimeFormat('en-US', {timeZone:'America/Detroit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'});
    const historyTime = ms => historyTimeFormatter.format(new Date(ms));
    function renderHistoryPlot(model, key) {
      const svg = $(key==='watts' ? 'history-power' : 'history-soc');
      const left=65, right=880, top=16, bottom=193;
      let limit=100;
      if (key==='watts') {
        const maximum = model.rows.reduce((n,r)=>r.valid?Math.max(n,Math.abs(r.watts)):n,1000);
        const magnitude=10**Math.floor(Math.log10(maximum));
        limit=[1,2,5,10].find(n=>n*magnitude>=maximum)*magnitude;
      }
      const min=key==='watts'?-limit:0, max=limit;
      const x=time=>left+(time+30000-model.start)/(model.end-model.start)*(right-left);
      const y=value=>bottom-(value-min)/(max-min)*(bottom-top);
      const number = n => n.toFixed(2);
      let markup='';
      for (let i=0;i<5;++i) {
        const value=min+(max-min)*i/4, at=y(value);
        const label=key==='watts'?(value/1000).toFixed(1).replace(/\.0$/,''):String(value)+'%';
        markup+=`<line x1="${left}" x2="${right}" y1="${number(at)}" y2="${number(at)}" stroke="#2b3b4b"/><text x="${left-10}" y="${number(at+4)}" fill="#a9bbca" font-size="13" text-anchor="end">${label}</text>`;
        const time=model.start+(model.end-model.start)*i/4, px=left+(right-left)*i/4;
        markup+=`<text x="${number(px)}" y="218" fill="#a9bbca" font-size="12" text-anchor="${i===0?'start':i===4?'end':'middle'}">${historyTime(time)}</text>`;
      }
      const runs=historyRuns(model);
      const path=runs.filter(run=>run.length>1).map(run=>run.map((r,i)=>`${i?'L':'M'}${number(x(r.time))},${number(y(r[key]))}`).join(' ')).join(' ');
      if(key==='watts') {
        const zero=y(0);
        markup+=`<defs><clipPath id="history-positive"><rect x="${left}" y="${top}" width="${right-left}" height="${zero-top}"/></clipPath><clipPath id="history-negative"><rect x="${left}" y="${zero}" width="${right-left}" height="${bottom-zero}"/></clipPath></defs>
          <path d="${path}" fill="none" stroke="#61e4aa" stroke-width="2" clip-path="url(#history-positive)"/><path d="${path}" fill="none" stroke="#ff7979" stroke-width="2" clip-path="url(#history-negative)"/>`;
      } else markup+=`<path d="${path}" fill="none" stroke="#7ab6ff" stroke-width="2"/>`;
      for(const run of runs) if(run.length===1) {
        const r=run[0], color=key==='watts'?(r.watts>0?'#61e4aa':r.watts<0?'#ff7979':'#93a6b8'):'#7ab6ff';
        markup+=`<circle cx="${number(x(r.time))}" cy="${number(y(r[key]))}" r="3" fill="${color}" stroke="${r.complete?color:'#ffd23f'}" stroke-width="1.5"/>`;
      }
      if(!model.validCount)markup+='<text x="460" y="100" fill="#a9bbca" font-size="16" text-anchor="middle">No valid readings recorded for this day</text>';
      markup+=`<line id="${key==='watts'?'history-power-cursor':'history-soc-cursor'}" x1="${left}" x2="${left}" y1="${top}" y2="${bottom}" stroke="#cfdae6" stroke-dasharray="3 4" visibility="hidden" pointer-events="none"/>`;
      svg.innerHTML=markup;
      svg.onpointermove = event => {
        const box=svg.getBoundingClientRect(), position=(event.clientX-box.left)/box.width*900;
        const time=model.start+(Math.max(left,Math.min(right,position))-left)/(right-left)*(model.end-model.start);
        inspectHistory(model,time);
      };
      svg.onpointerdown=svg.onpointermove;
      svg.onkeydown=event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();
        const count=Math.round((model.end-model.start)/60000);
        historyCursor=event.key==='Home'?0:event.key==='End'?count-1:Math.max(0,Math.min(count-1,historyCursor+(event.key==='ArrowRight'?1:-1)));
        inspectHistory(model,model.start+historyCursor*60000);
      };
    }
    function inspectHistory(model,time) {
      const count=Math.round((model.end-model.start)/60000);
      historyCursor=Math.max(0,Math.min(count-1,Math.floor((time-model.start)/60000)));
      const at=model.start+historyCursor*60000, row=model.byTime.get(at);
      const x=65+(at+30000-model.start)/(model.end-model.start)*815;
      for(const id of ['history-power-cursor','history-soc-cursor']) {
        $(id).setAttribute('x1',x.toFixed(2));$(id).setAttribute('x2',x.toFixed(2));$(id).setAttribute('visibility','visible');
      }
      $('history-hover').textContent=historyTime(at)+' · '+(!row?'No record':!row.valid?'Missing readings':
        `${(row.watts/1000).toFixed(2)} kW · ${row.soc.toFixed(1)}% SOC · ${row.coverage.toFixed(1)} s covered · ${row.quality.replaceAll('_',' ')}`);
    }
    function renderHistoryGraphs(model) {
      historyModel=model;historyCursor=0;
      const energy=model.validCount?`${(model.chargedWh/1000).toFixed(3)} kWh charged / ${(model.dischargedWh/1000).toFixed(3)} kWh discharged`:'No measured energy';
      $('history-summary').textContent=`${model.date} · Recorded energy: ${energy} · ${(model.coverage/3600).toFixed(2)} h covered in a ${(model.end-model.start)/3600000} h day · ${model.partialCount} partial / ${model.missingCount} missing rows`+
        (model.invalid?` · ${model.invalid} invalid rows skipped`:'')+(model.duplicates?` · ${model.duplicates} duplicate minutes replaced`:'');
      renderHistoryPlot(model,'watts');renderHistoryPlot(model,'soc');
      if(model.rows.length)inspectHistory(model,model.rows.find(r=>r.valid)?.time ?? model.rows[0].time);
    }
    let sdState = null;
    let sdRequestPending = false;
    let sdDownloadActive = false;
    function updateSdButtons() {
      const busy = !sdState || sdState.busy || sdRequestPending || sdDownloadActive;
      $('sd-refresh').disabled = !!busy;
      $('sd-test').disabled = !!busy || !sdState.mounted;
      $('sd-erase-confirm').disabled = !!busy || !sdState.mounted;
      $('sd-erase').disabled = !!busy || !sdState.mounted || $('sd-erase-confirm').value !== 'ERASE';
      $('sd-download').disabled = !!busy || !sdState.mounted;
      $('history-load').disabled = !!busy || !sdState.mounted;
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
        ` · ${Number(state.rows_written || 0)} rows saved since restart · ${Number(state.dropped_minutes || 0)} minutes not saved`;
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
      if (!sdState || sdState.busy || sdRequestPending || sdDownloadActive || !transport) return;
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
    async function loadDailyCsv(date, graph = false) {
      if (!sdState || !sdState.mounted || sdState.busy || sdRequestPending || sdDownloadActive || !transport) return;
      const status = $(graph?'history-load-status':'sd-download-status');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { status.textContent = 'Choose a date.'; return; }
      if(graph) {
        historyModel=null;
        for(const id of ['history-power','history-soc']) {
          const svg=$(id);svg.innerHTML='';svg.onpointermove=null;svg.onpointerdown=null;svg.onkeydown=null;
        }
        $('history-summary').textContent='';$('history-hover').textContent='';
      }
      status.textContent='Loading '+date+'…';
      sdDownloadActive = true; updateSdButtons();
      const token = Date.now().toString(16) + Math.floor(Math.random()*0xffffffff).toString(16);
      const parts = []; let offset = 0, limit = null;
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      try {
        while (limit === null || offset < limit) {
          let chunk = null;
          for (let retry=0; retry<10 && !chunk; ++retry) {
            const command = date + '|' + offset + '|' + token;
            const response = await fetch('/text/' + encodeURIComponent('SD Log Read') + '/set?value=' + encodeURIComponent(command),
              {method:'POST', credentials:'same-origin', signal:AbortSignal.timeout(5000)});
            if (!response.ok) throw new Error('HTTP ' + response.status);
            await pause(300);
            const check = await fetch('/text_sensor/' + encodeURIComponent('SD Card Diagnostics'),
              {credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(5000)});
            if (!check.ok) throw new Error('HTTP ' + check.status);
            const data = await check.json(), state = JSON.parse(data.state);
            receiveSd(data);
            if (state.export && state.export.token === token && state.export.date === date && state.export.offset === offset) chunk = state.export;
          }
          if (!chunk) throw new Error('Card busy or download response timed out. Try again.');
          if (chunk.error) throw new Error(chunk.error);
          if (!Number.isInteger(chunk.size) || chunk.size < 1 || chunk.size > 1048576 || typeof chunk.data !== 'string') throw new Error('Invalid CSV response');
          if (limit === null) limit = chunk.size;
          if (!chunk.data.length || chunk.size < limit) throw new Error('CSV changed during download. Try again.');
          const part = chunk.data.slice(0, limit-offset);
          parts.push(part); offset += part.length;
          status.textContent = `Loading ${date}: ${offset.toLocaleString()} / ${limit.toLocaleString()} bytes`;
        }
        if(graph) {
          renderHistoryGraphs(parseMinuteHistory(parts.join(''),date));
          status.textContent='Loaded '+date+' · Snapshot from SD card';
        } else {
          const url = URL.createObjectURL(new Blob(parts, {type:'text/csv;charset=utf-8'}));
          const link = document.createElement('a'); link.href = url; link.download = 'PawPower-' + date + '.csv';
          document.body.appendChild(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          status.textContent = 'Downloaded PawPower-' + date + '.csv';
        }
      } catch (error) { status.textContent = (graph?'Graph load failed: ':'Download failed: ') + error.message; }
      finally { sdDownloadActive = false; updateSdButtons(); }
    }
    $('sd-download').onclick = () => loadDailyCsv($('sd-log-date').value);
    $('history-date').value = michiganDate(Date.now());
    $('history-load').onclick = () => loadDailyCsv($('history-date').value,true);
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
      $('bank-description').textContent=`48V bank · Junctek shunt · ${capacity.toLocaleString()}Ah`;
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
      if (normalized.endsWith('bus_traffic_activity')) {receiveTraffic(data);return;}
      if (normalized.endsWith('sd_card_diagnostics')) {receiveSd(data);return;}
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
    connect();setInterval(connectionTick,1000);render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
