#pragma once
#include "esphome/components/web_server_base/web_server_base.h"
namespace pawcommon {
// Canonical Paw Ball implementation. Both dashboard entrypoints load this asset.
inline const char PAW_BALL_JS[] = R"PAWCOMMONJS(
(()=>{'use strict';
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

function mountNotificationTest() {
  if (document.getElementById('paw-notification-test')) return;
  const main = document.querySelector('main');
  if (!main) return;
  if (!document.getElementById('cloud-uploads-toggle')) {
    const cloud = document.createElement('section');
    cloud.className = 'panel card'; cloud.style.cssText = 'padding:18px;margin-top:14px';
    cloud.innerHTML = '<h2>Cloud support</h2><button id="cloud-uploads-toggle" role="switch" aria-checked="false" disabled>Cloud Uploads: Off</button><p id="cloud-uploads-feedback" role="status"></p><p class="note">Optional. Local monitoring works with cloud support off.</p>';
    main.insertBefore(cloud, main.querySelector('footer'));
    mountDevicePreferences(cloud);
  }
  const panel = document.createElement('section');
  panel.id = 'paw-notification-test';
  panel.className = 'panel card';
  panel.style.cssText = 'padding:18px;margin-top:14px';
  panel.innerHTML = '<h2 style="font-size:16px;margin:0 0 8px">Phone notifications</h2>' +
    '<p class="note">Send a test to your registered PawPower phones. No keys to enter.</p>' +
    '<button type="button" disabled>Send test notification</button>' +
    '<p class="note" role="status" aria-live="polite">Checking notification support…</p>';
  const preferences = document.getElementById('paw-preferences');
  if (preferences) preferences.appendChild(panel);
  else main.insertBefore(panel, main.querySelector('footer'));
  const button = panel.querySelector('button'), feedback = panel.querySelector('[role="status"]');
  let available = false, sending = false, until = 0, sequence = 0, busy = false;
  const messages = [
    'Ready to send a test notification.',
    'Sending test notification…',
    'FCM accepted the test. Check your phone notification shade.',
    'FCM accepted the test for some phones; other phones failed.',
    'Please wait 60 seconds between test notifications.',
    'Push sending is disabled on the server.',
    'No phone is registered. Connect your phone in PawPower Setup.',
    'Device upload token was rejected. Check ESPHome secrets.',
    'Server update needed: upload device-test.php first.',
    'Cloud connection failed. Check the device Wi-Fi and clock.',
    'The test failed. Check server setup and try again later.',
    'Device cloud setup is incomplete. Check its saved upload token.',
    'Cloud support is off. Enable Cloud Uploads to use phone notifications.'
  ];
  const endpoint = '/text_sensor/' + encodeURIComponent('Cloud Test Status');
  async function readStatus() {
    const response = await fetch(endpoint, {credentials:'same-origin', cache:'no-store',
      signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw Error('unsupported');
    const entity = await response.json();
    const status = JSON.parse(entity.value ?? entity.state);
    if (!Number.isInteger(status.sequence) || !Number.isInteger(status.state) ||
        status.state < 0 || status.state >= messages.length) throw Error('invalid');
    return status;
  }
  function updateButton() { button.disabled = !available || sending || Date.now() < until; }
  async function poll() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const status = await readStatus();
      available = status.state !== 12;
      if (!sending) {
        sequence = status.sequence;
        feedback.textContent = messages[status.state];
      }
    } catch (_) {
      available = false;
      if (!sending) feedback.textContent = 'Test notifications need updated cloud-enabled firmware.';
    } finally { busy = false; updateButton(); }
  }
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    sending = true; until = Date.now() + 60000; updateButton();
    feedback.textContent = 'Requesting a test notification…';
    try {
      const before = await readStatus();
      sequence = before.sequence;
      const response = await fetch('/button/' + encodeURIComponent('Cloud Test Notification') + '/press',
        {method:'POST', credentials:'same-origin', signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw Error('request');
      let finished = false;
      for (let attempt = 0; attempt < 20; ++attempt) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const status = await readStatus();
        if (status.sequence !== sequence && status.state !== 1) {
          feedback.textContent = messages[status.state];
          sequence = status.sequence; finished = true; break;
        }
      }
      if (!finished) feedback.textContent = 'No result received yet. Check your phone before trying again.';
    } catch (_) {
      feedback.textContent = 'Could not confirm the test. Check your phone before retrying in 60 seconds.';
    } finally { sending = false; updateButton(); }
  });
  setInterval(() => { updateButton(); if (!sending) poll(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !sending) poll(); });
  poll();
}

function mountDevicePreferences(root) {
  const definitions = [
    {name:'Cloud Uploads', selector:'#cloud-uploads-toggle', feedback:'#cloud-uploads-feedback'},
    {name:'Phone Alerts', selector:'#phone-alerts-toggle', feedback:'#phone-alerts-feedback'}
  ];
  const truth = entity => {
    if (typeof entity.value === 'boolean') return entity.value;
    if (entity.value === 0 || entity.value === 1) return entity.value === 1;
    const state = String(entity.state || '').toUpperCase();
    if (state === 'ON') return true;
    if (state === 'OFF') return false;
    throw Error('Unknown switch state');
  };
  for (const definition of definitions) {
    const button = root.querySelector(definition.selector);
    const feedback = root.querySelector(definition.feedback);
    if (!button || !feedback) continue;
    const endpoint = '/switch/' + encodeURIComponent(definition.name);
    let saved = null, busy = false;
    const render = () => {
      button.disabled = busy || saved === null;
      button.setAttribute('aria-checked', String(saved === true));
      button.textContent = definition.name + ': ' + (saved === null ? 'Unavailable' : saved ? 'On' : 'Off');
    };
    async function read() {
      const response = await fetch(endpoint, {credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw Error('Device setting is unavailable. Update firmware or check connection.');
      return truth(await response.json());
    }
    async function refresh() {
      if (busy || document.hidden) return;
      busy = true; render();
      try {
        saved = await read();
        feedback.textContent = 'Saved on device: ' + (saved ? 'On' : 'Off');
      } catch (error) {
        saved = null; feedback.textContent = error.message;
      } finally { busy = false; render(); }
    }
    button.addEventListener('click', async () => {
      if (busy || saved === null) return;
      // Use current device state, not a browser default or an unconfirmed optimistic value.
      busy = true; render();
      try {
        const current = await read();
        const desired = !current;
        const response = await fetch(endpoint + (desired ? '/turn_on' : '/turn_off'),
          {method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
        if (!response.ok) throw Error('Could not save this setting.');
        const confirmed = await read();
        if (confirmed !== desired) throw Error('Save not confirmed. Check the device state before retrying.');
        saved = confirmed;
        feedback.textContent = 'Saved on device: ' + (saved ? 'On' : 'Off');
      } catch (error) {
        saved = null; feedback.textContent = error.message;
      } finally { busy = false; render(); }
    });
    refresh();
    setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
}

const pawAlertMetrics = {
  battery_voltage:{label:'Voltage',unit:'V',min:0,max:1000},
  battery_soc:{label:'State of charge',unit:'%',min:0,max:100},
  battery_temperature_c:{label:'Temperature',unit:'°F',min:-100,max:150},
  battery_current:{label:'Current',unit:'A',min:-2000,max:2000}
};
const pawAlertLabels = {
  low_voltage:'Low voltage',low_soc:'Low state of charge',low_temp:'Low temperature',
  high_temp:'High temperature',danger_temp:'Danger high temperature',
  charging:'Battery charging',full:'Battery full',
  custom_1:'Custom level 1',custom_2:'Custom level 2',custom_3:'Custom level 3'
};
function alertTemperatureFromWire(value){return Math.round((value*1.8+32)*1e6)/1e6;}
function alertTemperatureToWire(value){return Math.round((value-32)/1.8*1e6)/1e6;}
function validateAlertPreferences(data) {
  const prefs=data?.preferences;
  if(typeof data?.enabled!=='boolean' || !/^[a-f0-9]{32}$/.test(data?.revision||'') ||
      prefs?.version!==1 || !Number.isInteger(prefs.delay) || prefs.delay<30 || prefs.delay>600 ||
      !Array.isArray(prefs.rules) || prefs.rules.length!==10)
    throw Error('Invalid preferences. Delay must be 30–600 seconds.');
  const seen=new Set();
  for(const rule of prefs.rules) {
    const metric=pawAlertMetrics[rule.metric];
    if(!pawAlertLabels[rule.id] || seen.has(rule.id) || !metric || typeof rule.enabled!=='boolean' ||
        !['above','below'].includes(rule.direction) || !Number.isFinite(rule.threshold) ||
        rule.threshold<metric.min || rule.threshold>metric.max)
      throw Error('Check rule levels and units. SOC must be 0–100%.');
    seen.add(rule.id);
  }
  const value=id=>prefs.rules.find(rule=>rule.id===id).threshold;
  if(value('low_temp')>=value('high_temp') || value('high_temp')>=value('danger_temp'))
    throw Error('Temperatures must increase: low, high, then danger high.');
  if(value('low_soc')>=value('full')) throw Error('Low SOC must be below the full level.');
  return data;
}
function encodeDeviceAlertPreferences(data) {
  validateAlertPreferences(data);
  const metrics=Object.keys(pawAlertMetrics);
  const compact=JSON.stringify({r:data.revision,e:data.enabled,d:data.preferences.delay,
    l:Object.keys(pawAlertLabels).map(id=>{
      const rule=data.preferences.rules.find(item=>item.id===id);
      return id.startsWith('custom_')?[rule.enabled?1:0,metrics.indexOf(rule.metric),
        rule.direction==='above'?1:0,rule.threshold]:[rule.enabled?1:0,rule.threshold];
    })});
  if(compact.length>255)throw Error('Use shorter numbers for levels (up to two decimal places).');
  return compact;
}
function sameAlertSettings(a,b) {
  return a.enabled===b.enabled && a.preferences.delay===b.preferences.delay &&
    a.preferences.rules.length===b.preferences.rules.length && a.preferences.rules.every(rule=>{
      const other=b.preferences.rules.find(item=>item.id===rule.id);
      return other && ['enabled','metric','direction','threshold'].every(key=>rule[key]===other[key]);
    });
}
function mountAlertPreferences(root) {
  const section=document.createElement('section');
  section.style.marginTop='18px';
  section.innerHTML='<h3>Battery notifications</h3><p class="note">Shared with Android and all registered phones. Cloud Uploads must be on. Alerts work while the app is closed. Set levels for your battery before enabling alerts.</p>';
  root.appendChild(section);
  const form=document.createElement('form');
  section.appendChild(form);
  const masterLabel=document.createElement('label'),master=document.createElement('input');
  master.type='checkbox';masterLabel.append(master,document.createTextNode(' Phone alerts'));
  form.append(masterLabel);
  const delayLabel=document.createElement('label'),delay=document.createElement('input');
  delay.type='number';delay.min='30';delay.max='600';delay.step='1';delay.required=true;
  delayLabel.style.cssText='display:block;margin:14px 0';
  delayLabel.append(document.createTextNode('Confirmation delay (seconds) '),delay);
  form.append(delayLabel);
  const rows=[];
  for(const [id,title] of Object.entries(pawAlertLabels)) {
    const card=document.createElement('fieldset');
    card.style.cssText='border:1px solid #294256;border-radius:12px;padding:14px;margin:12px 0;display:flex;flex-wrap:wrap;gap:12px;align-items:center';
    const legend=document.createElement('legend');legend.textContent=title;card.append(legend);
    const enabledLabel=document.createElement('label'),enabled=document.createElement('input');
    enabled.type='checkbox';enabledLabel.append(enabled,document.createTextNode(' Enabled'));card.append(enabledLabel);
    const metric=document.createElement('select');
    metric.setAttribute('aria-label',title+' reading');
    for(const [key,definition] of Object.entries(pawAlertMetrics)) {
      const option=document.createElement('option');option.value=key;option.textContent=definition.label;
      metric.append(option);
    }
    const direction=document.createElement('select');
    direction.setAttribute('aria-label',title+' comparison');
    for(const [key,label] of [['below','At or below'],['above','At or above']]) {
      const option=document.createElement('option');option.value=key;option.textContent=label;direction.append(option);
    }
    const label=document.createElement('label'),threshold=document.createElement('input'),unit=document.createElement('span');
    threshold.type='number';threshold.step='any';threshold.required=true;
    threshold.style.width='100px';threshold.setAttribute('aria-label',title+' threshold');
    label.append(threshold,unit);
    card.append(metric,direction,label);form.append(card);
    const custom=id.startsWith('custom_');
    metric.disabled=direction.disabled=!custom;
    const bounds=()=>{
      const definition=pawAlertMetrics[metric.value];if(!definition)return;
      threshold.min=String(metric.value==='battery_temperature_c'?-148:definition.min);threshold.max=String(metric.value==='battery_temperature_c'?302:definition.max);unit.textContent=' '+definition.unit;
    };
    metric.addEventListener('change',bounds);
    rows.push({id,enabled,metric,direction,threshold,unit,custom,bounds});
  }
  const note=document.createElement('p');note.className='note';
  note.textContent='Temperature levels use °F. Full uses SOC. Confirmation requires consecutive fresh samples. Recovery margins: 0.3 V, 2% SOC, 3.6°F, 0.3 A. Failed sends retry at most every 5 minutes.';
  form.append(note);
  const save=document.createElement('button');save.type='submit';save.textContent='Save notification preferences';form.append(save);
  const reload=document.createElement('button');reload.type='button';reload.textContent='Reload from server';reload.style.marginLeft='8px';form.append(reload);
  const feedback=document.createElement('p');feedback.className='note';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  feedback.textContent='Loading server preferences…';section.append(feedback);
  let saved=null,dirty=false,busy=false,lastSequence=0,cloudOff=false;
  const render=()=>{
    master.disabled=delay.disabled=busy||!saved||cloudOff;
    for(const row of rows) {
      row.enabled.disabled=row.threshold.disabled=busy||!saved||cloudOff;
      row.metric.disabled=row.direction.disabled=busy||!saved||cloudOff||!row.custom;
    }
    save.disabled=busy||!saved||cloudOff||!dirty;reload.disabled=busy;
  };
  const fill=data=>{
    saved=validateAlertPreferences(data);master.checked=data.enabled;delay.value=String(data.preferences.delay);
    for(const row of rows) {
      const rule=data.preferences.rules.find(rule=>rule.id===row.id);
      row.enabled.checked=rule.enabled;row.metric.value=rule.metric;row.direction.value=rule.direction;
      row.threshold.value=String(rule.metric==='battery_temperature_c'?alertTemperatureFromWire(rule.threshold):rule.threshold);row.bounds();
    }
    dirty=false;render();
  };
  const collect=()=>validateAlertPreferences({revision:saved.revision,enabled:master.checked,
    preferences:{version:1,delay:Number(delay.value),rules:rows.map(row=>({
      id:row.id,enabled:row.enabled.checked,metric:row.metric.value,direction:row.direction.value,
      threshold:row.threshold.value.trim()===''?NaN:(row.metric.value==='battery_temperature_c'?alertTemperatureToWire(Number(row.threshold.value)):Number(row.threshold.value))
    }))}});
  const read=async()=>{
    const response=await fetch('/text_sensor/'+encodeURIComponent('Notification Preferences State'),
      {credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Update display firmware to load notification preferences.');
    const entity=await response.json();return JSON.parse(entity.state);
  };
  const statusError=status=>status===423?'Cloud support is off. Enable Cloud Uploads to configure phone alerts.':status===409?'Preferences changed elsewhere. Reload before saving.':
    status===404?'Upload the new notification server files first.':
    status===401?'Server rejected the display device token.':
    status===400?'Server rejected these rules. Check levels and temperature order.':
    'Notification server unavailable. Check connection and server files.';
  async function refresh(force=false) {
    if(busy||document.hidden)return;
    try {
      const result=await read();lastSequence=result.sequence||0;
      cloudOff=result.status===423;
      if(result.status!==200)throw Error(statusError(result.status));
      if(!saved||force||!dirty) {
        fill(result.data);feedback.textContent='Loaded from server. Changes also appear in Android.';
      } else if(saved.revision!==result.data.revision) {
        feedback.textContent='Preferences changed elsewhere. Your edits are kept; reload before saving.';
      }
    } catch(error) { feedback.textContent=error.message; }
    render();
  }
  form.addEventListener('input',()=>{dirty=true;feedback.textContent='Unsaved changes';render();});
  form.addEventListener('change',()=>{dirty=true;feedback.textContent='Unsaved changes';render();});
  reload.addEventListener('click',()=>{if(!dirty||confirm('Discard edits and reload server preferences?'))refresh(true);});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!saved)return;
    let desired,compact;try{desired=collect();compact=encodeDeviceAlertPreferences(desired);}catch(error){feedback.textContent=error.message;return;}
    busy=true;render();feedback.textContent='Saving on server…';
    const baseline=lastSequence;
    try {
      const response=await fetch('/text/'+encodeURIComponent('Notification Preferences Request')+
        '/set?value='+encodeURIComponent(compact),
        {method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('Could not queue preferences on the display.');
      const deadline=Date.now()+30000;
      let confirmed=false;
      while(Date.now()<deadline) {
        await new Promise(resolve=>setTimeout(resolve,1000));
        const result=await read();
        if((result.sequence||0)<=baseline)continue;
        lastSequence=result.sequence;
        if(result.status!==200)throw Error(statusError(result.status));
        if(result.data.revision===desired.revision)continue;
        if(!sameAlertSettings(result.data,desired))throw Error('Another save completed. Reload before retrying.');
        fill(result.data);confirmed=true;
        feedback.textContent='Saved on server. Android can reload these preferences.';break;
      }
      if(!confirmed)throw Error('Save not confirmed. Reload before retrying; your edits are kept.');
    }catch(error){feedback.textContent=error.message;}
    finally{busy=false;render();}
  });
  render();refresh();setInterval(()=>refresh(),30000);
}

globalThis.PawPowerCommon={newPongMatch,stepPong,createPongAudio,mountPong,mountNotificationTest,mountDevicePreferences,mountAlertPreferences};
})();
)PAWCOMMONJS";
class CommonAssetHandler : public AsyncWebHandler {
 public:
  bool canHandle(AsyncWebServerRequest *request)const override {
    char url[AsyncWebServerRequest::URL_BUF_SIZE];
    return request->method()==HTTP_GET && request->url_to(url)=="/paw/common.js";
  }
  void handleRequest(AsyncWebServerRequest *request)override {
    request->send(200,"application/javascript",PAW_BALL_JS);
  }
};
inline void setup_web_assets(){
  static bool registered=false;
  if(!registered && esphome::web_server_base::global_web_server_base){
    esphome::web_server_base::global_web_server_base->add_handler(new CommonAssetHandler());
    registered=true;
  }
}
}
