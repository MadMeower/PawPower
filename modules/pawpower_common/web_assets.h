#pragma once
#include "esphome/components/web_server_base/web_server_base.h"
#include <mutex>
namespace pawcommon {
// The normal text-sensor JSON envelope repeats history as both state and value.
// ESPHome caps that envelope at 5119 bytes. Serve the original JSON once instead.
// The loop publishes a snapshot; the HTTP task only copies it under this mutex.
class EnergyHistorySnapshot {
 public:
  void publish(const std::string &json) {
    std::lock_guard<std::mutex> lock(mutex_);
    json_ = json;
  }
  std::string read() {
    std::lock_guard<std::mutex> lock(mutex_);
    return json_;
  }
 private:
  std::mutex mutex_;
  std::string json_;
};
inline EnergyHistorySnapshot &energy_history_snapshot() {
  static EnergyHistorySnapshot snapshot;
  return snapshot;
}
inline std::string cache_energy_history(std::string json) {
  energy_history_snapshot().publish(json);
  return json;
}
class EnergyHistoryHandler : public AsyncWebHandler {
 public:
  bool canHandle(AsyncWebServerRequest *request) const override {
    char url[AsyncWebServerRequest::URL_BUF_SIZE];
    return request->method() == HTTP_GET && request->url_to(url) == "/paw/energy-history";
  }
  void handleRequest(AsyncWebServerRequest *request) override {
    const auto json = energy_history_snapshot().read();
    auto *response = request->beginResponse(json.empty() ? 503 : 200, "application/json",
        json.empty() ? "{\"error\":\"History is starting\"}" : json);
    response->addHeader("Cache-Control", "no-store");
    request->send(response);
  }
};
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
function alertName(value='') {
  if(typeof value!=='string'||/[\x00-\x1f\x7f]/.test(value))throw Error('Alert names must be one line.');
  const name=value.trim();
  if([...name].length>32||encodeURIComponent(name).replace(/%[A-F\d]{2}|./g,'x').length>64)
    throw Error('Alert names allow up to 32 characters (64 UTF-8 bytes).');
  return name;
}
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
    if(rule.id.startsWith('custom_'))alertName(rule.name);
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
        rule.direction==='above'?1:0,rule.threshold,alertName(rule.name)]:[rule.enabled?1:0,rule.threshold];
    })});
  if(encodeURIComponent(compact).replace(/%[A-F\d]{2}|./g,'x').length>1024)throw Error('Alert settings are too long. Shorten names or numbers.');
  return compact;
}
function alertPreferencePackets(body,token) {
  const bytes=value=>encodeURIComponent(value).replace(/%[A-F\d]{2}|./g,'x').length;
  if(bytes(body)<=255)return [body];
  if(bytes(body)>1024)throw Error('Alert settings are too long.');
  if(!token)token=Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>n.toString(16).padStart(2,'0')).join('');
  const pieces=[];let piece='';
  for(const char of body) {
    if(bytes(piece+char)>80){pieces.push(piece);piece='';}
    piece+=char;
  }
  if(piece)pieces.push(piece);
  return pieces.map((value,i)=>'@'+token+':'+String(i).padStart(2,'0')+':'+String(pieces.length).padStart(2,'0')+':'+value);
}
function sameAlertSettings(a,b) {
  return a.enabled===b.enabled && a.preferences.delay===b.preferences.delay &&
    a.preferences.rules.length===b.preferences.rules.length && a.preferences.rules.every(rule=>{
      const other=b.preferences.rules.find(item=>item.id===rule.id);
      return other && ['enabled','metric','direction','threshold'].every(key=>rule[key]===other[key]) &&
        alertName(rule.name)===alertName(other.name);
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
    const name=document.createElement('input');
    name.type='text';name.maxLength=32;name.placeholder='Alert name (optional)';
    name.setAttribute('aria-label',title+' name');
    if(custom)card.append(name);
    metric.disabled=direction.disabled=!custom;
    const bounds=()=>{
      const definition=pawAlertMetrics[metric.value];if(!definition)return;
      threshold.min=String(metric.value==='battery_temperature_c'?-148:definition.min);threshold.max=String(metric.value==='battery_temperature_c'?302:definition.max);unit.textContent=' '+definition.unit;
    };
    metric.addEventListener('change',bounds);
    rows.push({id,enabled,metric,direction,threshold,unit,custom,bounds,name});
  }
  const note=document.createElement('p');note.className='note';
  note.textContent='Changes may take up to one minute to apply and confirm. Temperature levels use °F. Full uses SOC. Confirmation requires consecutive fresh samples. Recovery margins: 0.3 V, 2% SOC, 3.6°F, 0.3 A. Failed sends retry at most every 5 minutes.';
  form.append(note);
  const save=document.createElement('button');save.type='submit';save.textContent='Save notification preferences';form.append(save);
  const reload=document.createElement('button');reload.type='button';reload.textContent='Reload from server';reload.style.marginLeft='8px';form.append(reload);
  const feedback=document.createElement('p');feedback.className='note';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  feedback.textContent='Loading server preferences…';section.append(feedback);
  let saved=null,dirty=false,busy=false,lastSequence=0,cloudOff=false;
  const render=()=>{
    master.disabled=delay.disabled=busy||!saved||cloudOff;
    for(const row of rows) {
      row.name.disabled=row.enabled.disabled=row.threshold.disabled=busy||!saved||cloudOff;
      row.metric.disabled=row.direction.disabled=busy||!saved||cloudOff||!row.custom;
    }
    save.disabled=busy||!saved||cloudOff||!dirty;reload.disabled=busy;
  };
  const fill=data=>{
    saved=validateAlertPreferences(data);master.checked=data.enabled;delay.value=String(data.preferences.delay);
    for(const row of rows) {
      const rule=data.preferences.rules.find(rule=>rule.id===row.id);
      row.name.value=rule.name||'';
      row.enabled.checked=rule.enabled;row.metric.value=rule.metric;row.direction.value=rule.direction;
      row.threshold.value=String(rule.metric==='battery_temperature_c'?alertTemperatureFromWire(rule.threshold):rule.threshold);row.bounds();
    }
    dirty=false;render();
  };
  const collect=()=>validateAlertPreferences({revision:saved.revision,enabled:master.checked,
    preferences:{version:1,delay:Number(delay.value),rules:rows.map(row=>({
      id:row.id,enabled:row.enabled.checked,metric:row.metric.value,direction:row.direction.value,
      ...(row.custom?{name:alertName(row.name.value)}:{}),
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
      for(const packet of alertPreferencePackets(compact)) {
        const response=await fetch('/text/'+encodeURIComponent('Notification Preferences Request')+
          '/set?value='+encodeURIComponent(packet),
          {method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
        if(!response.ok)throw Error('Could not queue preferences. Update Display firmware before saving names.');
      }
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
        feedback.textContent='Saved on server. Changes may take up to one minute to apply and confirm.';break;
      }
      if(!confirmed)throw Error('Save not confirmed. Reload before retrying; your edits are kept.');
    }catch(error){feedback.textContent=error.message;}
    finally{busy=false;render();}
  });
  render();refresh();setInterval(()=>refresh(),30000);
}


function equipmentView(value, device) {
  if(!value || !/^[a-f0-9]{32}$/.test(value.revision) ||
      !Number.isInteger(value.delay)||value.delay<30||value.delay>600 ||
      typeof value.notifications_enabled!=='boolean'||!/^[a-f0-9]{32}$/.test(value.notifications_revision))
    throw Error('Invalid equipment preferences.');
  const out={revision:value.revision,delay:value.delay,notifications_enabled:value.notifications_enabled,
    notifications_revision:value.notifications_revision};
  if(device==='pawpower') {
    if(typeof value.can_faults!=='boolean')throw Error('Invalid CAN preference.');
    out.can_faults=value.can_faults;
  } else if(device==='tracer') {
    if(typeof value.tracer_faults!=='boolean')throw Error('Invalid Tracer preference.');
    out.tracer_faults=value.tracer_faults;
    for(const key of ['controller_high','battery_high']) {
      const r=value[key];
      if(!r||typeof r.enabled!=='boolean'||!Number.isFinite(r.threshold_c)||r.threshold_c< -100||r.threshold_c>150)
        throw Error('Check temperature ranges.');
      out[key]={enabled:r.enabled,threshold_c:r.threshold_c};
    }
  } else throw Error('Unknown device.');
  return out;
}
function encodeEquipmentPreferences(value, device) {
  const v=equipmentView(value,device),body={r:v.revision,d:v.delay};
  if(device==='pawpower')body.c=v.can_faults;
  else Object.assign(body,{m:v.notifications_revision,n:v.notifications_enabled,f:v.tracer_faults,
    h:[v.controller_high.enabled,Number(v.controller_high.threshold_c.toFixed(6))],
    b:[v.battery_high.enabled,Number(v.battery_high.threshold_c.toFixed(6))]});
  const wire=JSON.stringify(body);if(wire.length>255)throw Error('Equipment request is too large.');return wire;
}
function sameEquipmentPreferences(a,b,device) {
  if(a.delay!==b.delay)return false;
  if(device==='pawpower')return a.can_faults===b.can_faults;
  return a.notifications_enabled===b.notifications_enabled&&a.tracer_faults===b.tracer_faults&&
    ['controller_high','battery_high'].every(k=>a[k].enabled===b[k].enabled&&Math.abs(a[k].threshold_c-b[k].threshold_c)<0.00001);
}
function mountEquipmentPreferences(root,device) {
  const tracer=device==='tracer',section=document.createElement('details');
  section.className='panel card preferences-section';section.style.padding='16px';section.style.marginTop='16px';
  section.innerHTML='<summary style="cursor:pointer;font-weight:650">'+(tracer?'Tracer notifications':'6000XP CAN notifications')+'</summary>'+
    '<p class="note">Shared with the Android app. Changes may take up to one minute to apply and confirm.</p>'+
    '<form><fieldset disabled style="border:0;padding:0"><div data-equipment-fields></div>'+
    '<p><label>Shared equipment confirmation delay (seconds) <input name="delay" type="number" min="30" max="600" step="1" required></label></p>'+
    '<button type="submit" disabled>Save notification preferences</button></fieldset></form>'+
    '<button type="button" data-equipment-reload>Reload from server</button><p class="note" role="status">Open to load notification preferences. Cloud Uploads must be On.</p>';
  root.appendChild(section);
  const form=section.querySelector('form'),fields=section.querySelector('[data-equipment-fields]'),fieldset=section.querySelector('fieldset');
  fields.innerHTML=tracer?
    '<p><label><input type="checkbox" name="notifications_enabled"> Notifications master (shared with Shunt and app)</label></p>'+
    '<p><label><input type="checkbox" name="tracer_faults"> Tracer controller faults</label></p>'+
    '<p><label><input type="checkbox" name="controller_enabled"> High controller temperature</label> '+
    '<label>Limit (°F) <input type="number" name="controller_f" min="-148" max="302" step="0.1" required></label></p>'+
    '<p><label><input type="checkbox" name="battery_enabled"> High Tracer battery-probe temperature</label> '+
    '<label>Limit (°F) <input type="number" name="battery_f" min="-148" max="302" step="0.1" required></label></p>':
    '<p><label><input type="checkbox" name="can_faults"> 6000XP CAN communication errors</label></p>'+
    '<p class="note">Internal inverter fault codes are unavailable through the current CAN connection. Use the Notifications master in the battery notification settings.</p>';
  const input=name=>form.querySelector('[name="'+name+'"]'),save=form.querySelector('button[type="submit"]');
  const reload=section.querySelector('[data-equipment-reload]'),feedback=section.querySelector('[role="status"]');
  let saved=null,dirty=false,busy=false;
  const visible=()=>section.open&&!document.hidden&&!section.closest?.('details:not([open])');
  const render=()=>{fieldset.disabled=busy||!saved;save.disabled=busy||!saved||!dirty;reload.disabled=busy;};
  const read=async()=>{
    const response=await fetch('/text_sensor/'+encodeURIComponent('Equipment Preferences State'),
      {credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Update this device firmware to enable equipment preferences.');
    const entity=await response.json(),result=JSON.parse(entity.value??entity.state);
    if(!Number.isInteger(result.status))throw Error('Invalid device response.');
    return result;
  };
  const statusError=code=>code===423?'Enable Cloud Uploads to configure notifications.':
    code===409?'Preferences changed elsewhere. Reload before saving.':
    code===404?'Upload the updated equipment-preferences.php server file first.':
    code===401?'Device token rejected by the server.':'Equipment service unavailable. Your edits are kept.';
  async function exchange(body,desired=null) {
    const before=await read();
    const response=await fetch('/text/'+encodeURIComponent('Equipment Preferences Request')+'/set?value='+encodeURIComponent(body),
      {method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Could not queue the preferences request.');
    let last=before;
    for(let i=0;i<10;i++) {
      await new Promise(resolve=>setTimeout(resolve,2000));last=await read();
      if((last.sequence||0)<=(before.sequence||0))continue;
      if(last.status!==200)throw Error(statusError(last.status));
      const result=equipmentView(last.data,device);
      if(desired&&(result.revision===desired.revision||!sameEquipmentPreferences(result,desired,device)))
        throw Error('Save not confirmed. Reload before retrying; your edits are kept.');
      return result;
    }
    throw Error(last.status===423?statusError(423):'No confirmed result. Reload before retrying.');
  }
  function fill(value) {
    saved=value;input('delay').value=String(value.delay);
    if(tracer) {
      input('notifications_enabled').checked=value.notifications_enabled;input('tracer_faults').checked=value.tracer_faults;
      for(const [field,prefix] of [['controller_high','controller'],['battery_high','battery']]) {
        input(prefix+'_enabled').checked=value[field].enabled;
        input(prefix+'_f').value=String(Number((value[field].threshold_c*1.8+32).toFixed(1)));
      }
    } else input('can_faults').checked=value.can_faults;
    dirty=false;
  }
  async function refresh(force=false) {
    if(busy||!visible()||dirty&&!force)return;
    busy=true;render();feedback.textContent='Loading server preferences…';
    try{fill(await exchange('GET'));feedback.textContent='Loaded from server. Notifications master: '+(saved.notifications_enabled?'On':'Off')+'.';}
    catch(error){feedback.textContent=error.message;}
    finally{busy=false;render();}
  }
  form.addEventListener('input',()=>{dirty=true;feedback.textContent='Unsaved changes';render();});
  form.addEventListener('change',()=>{dirty=true;render();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!saved)return;
    let desired,body;
    try {
      desired={...saved,delay:input('delay').value.trim()===''?NaN:Number(input('delay').value)};
      if(tracer) {
        desired.notifications_enabled=input('notifications_enabled').checked;desired.tracer_faults=input('tracer_faults').checked;
        for(const [field,prefix] of [['controller_high','controller'],['battery_high','battery']]) {
          const text=input(prefix+'_f').value.trim(),f=Number(text);
          desired[field]={enabled:input(prefix+'_enabled').checked,threshold_c:text===''?NaN:(f-32)/1.8};
        }
      } else desired.can_faults=input('can_faults').checked;
      body=encodeEquipmentPreferences(desired,device);
    }catch(error){feedback.textContent=error.message;return;}
    busy=true;render();feedback.textContent='Saving… Changes may take up to one minute to apply and confirm.';
    try{fill(await exchange(body,desired));feedback.textContent='Saved on server. Changes may take up to one minute to apply and confirm.';}
    catch(error){feedback.textContent=error.message;}
    finally{busy=false;render();}
  });
  reload.addEventListener('click',()=>{if(!dirty||confirm('Discard equipment preference edits?'))refresh(true);});
  section.addEventListener('toggle',()=>{if(section.open)refresh();});
  root.addEventListener?.('toggle',()=>{if(section.open)refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(()=>refresh(),60000);render();
}
function errorLogLabel(code,value) {
  const can=['CAN communication recovered','CAN initialization failed','CAN status read failed','CAN bus-off / recovery',
    'CAN start failed','CAN transmit backlog','CAN transmit failed','CAN transmission errors'];
  if(code===1){const reasons={1:'power on',3:'software restart',4:'panic / abort',5:'interrupt watchdog',6:'task watchdog',7:'watchdog',9:'brownout'};
    return 'Startup observed · '+(reasons[value]||'reset reason '+value);}
  if(code===10)return can[value]||'CAN error '+value;
  if(code===12)return value?'Shunt readings missing or stale':'Shunt readings recovered';
  if(code===20)return value?'Controller fault flags 0x'+value.toString(16).padStart(4,'0'):'Controller fault flags cleared';
  if(code===22)return value?'Tracer readings missing or stale':'Tracer readings recovered';
  if(code===24)return 'Modbus exceptions · '+value+' since previous summary';
  if(code===26){const state=value>>8,exception=value&255;
    return ({3:'Manual charging command acknowledged',4:'Manual charging command rejected · exception '+exception,
      5:'Manual charging command timed out',6:'Manual charging command refused in Listen mode',7:'Manual charging command cancelled'})[state]||'Charging command result '+state;}
  if(code===30)return value?'Wi-Fi disconnected':'Wi-Fi reconnected';
  if(code===35)return value?'Local readings archive error · '+({2:'installed storage partition too small',3:'storage could not open',4:'saved data unreadable or corrupt',5:'save failed or storage reserve reached',6:'worker could not start',7:'clock moved backwards'}[value]||value):'Local readings archive recovered';
  if(code===32)return ['Cloud uploads recovered','Cloud upload connection failed','Cloud device token rejected','Cloud upload rejected by server','Cloud uploader setup failed'][value]||'Cloud upload error '+value;
  if(code===33||code===34){const part=code===33?'Alert checks':'History uploads';
    return value===0?part+' recovered':part+' failed · '+({2:'server endpoint missing',3:'device token rejected',4:'network or server error'}[value]||value);}
  return 'Event '+code+' · '+value;
}
function parseErrorLog(value) {
  const x=typeof value==='string'?JSON.parse(value):value;
  if(!x || typeof x.clock!=='boolean'||typeof x.rollback!=='boolean'||!Number.isInteger(x.date)||
      typeof x.token!=='string'||!Array.isArray(x.days)||x.days.length>7||
      !x.days.every(Number.isInteger)||!Number.isInteger(x.omitted)||x.omitted<0||
      !Array.isArray(x.entries)||x.entries.length>32)throw Error('Invalid error history response.');
  for(const row of x.entries)if(!Array.isArray(row)||row.length!==3||
      !row.every(Number.isInteger)||row[0]<1||row[0]>4294967295||row[1]<0||row[1]>65535||row[2]<0||row[2]>65535)
    throw Error('Invalid saved error event.');
  return x;
}
function errorLogCsv(model) {
  const quote=s=>'"'+String(s).replace(/"/g,'""')+'"';
  return 'utc_time,event,code,detail\n'+model.entries.map(([time,code,value])=>
    [new Date(time*1000).toISOString(),errorLogLabel(code,value),code,value].map(quote).join(',')).join('\n')+'\n';
}
function logLocalDate(ms=Date.now()) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
  return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');
}
const tracerCsvHeader='utc_time,solar_watts,panel_voltage,panel_amps,battery_voltage,battery_amps,battery_temp_f,controller_temp_f,quality\n';
function parseTracerLogPage(value,expected) {
  const p=typeof value==='string'?JSON.parse(value):value;
  if(p?.token!==expected.token||p?.offset!==expected.offset)throw Error('Log response belongs to another request.');
  if(typeof p.error==='string')throw Error(p.error);
  if(p.version!==1||p.date!==expected.date||!Number.isInteger(p.start)||!Number.isInteger(p.end)||
      p.end<=p.start||p.end-p.start>26*3600||(p.end-p.start)%60||typeof p.done!=='boolean'||
      !Number.isInteger(p.next)||p.next!==Math.min(p.offset+15,(p.end-p.start)/60)||
      p.done!==(p.next===(p.end-p.start)/60)||typeof p.csv!=='string'||p.csv.length>4096||
      (expected.offset===0&&p.header!==tracerCsvHeader)||
      (expected.start!==undefined&&(p.start!==expected.start||p.end!==expected.end)))
    throw Error('Invalid daily log response. Download stopped.');
  let previous=0;const rows=p.csv===''?[]:p.csv.trimEnd().split('\n');
  if(rows.length>15||(p.csv&&!p.csv.endsWith('\n')))throw Error('Incomplete daily log page.');
  for(const row of rows){
    const cells=row.split(','),time=Date.parse(cells[0])/1000;
    if(cells.length!==9||!Number.isInteger(time)||!Number.isFinite(time)||time<=previous||
        time<p.start+p.offset*60||time>=p.start+p.next*60||
        new Date(time*1000).toISOString().replace('.000Z','Z')!==cells[0])
      throw Error('Invalid log timestamp. Download stopped.');
    let fresh=0;
    for(const cell of cells.slice(1,8)){
      if(cell==='')continue;
      if(!/^-?\d+(\.\d+)?$/.test(cell)||!Number.isFinite(Number(cell)))throw Error('Invalid logged reading.');
      ++fresh;
    }
    if(cells[8]!==(!fresh?'missing':fresh===7?'fresh':'partial'))throw Error('Invalid reading quality flag.');
    previous=time;
  }
  return {...p,rows:rows.length};
}
function tracerArchiveStatus(value) {
  const s=typeof value==='string'?JSON.parse(value):value;
  if(!s||!Number.isInteger(s.state)||s.state<0||s.state>7||typeof s.clock!=='boolean'||
      !Number.isInteger(s.saved)||s.saved<0||!Number.isInteger(s.buffered)||s.buffered<0||
      !Number.isInteger(s.dropped)||s.dropped<0)throw Error('Update Tracer firmware to use its daily archive.');
  const errors={0:'Reading archive is starting.',2:'Installed storage partition is too small for seven-day logs. Logging is disabled.',
    3:'Reading storage could not open.',4:'Some saved data could not be read; affected downloads will stop.',
    5:'Reading archive could not be saved, or its storage reserve was reached.',
    6:'Reading archive worker could not start.',7:'Clock moved backwards; recording is paused.'};
  let message=errors[s.state]||(!s.clock?'Waiting for the unit clock.':'Recording one snapshot per minute.');
  if(s.saved)message+=' Last committed sample: '+new Intl.DateTimeFormat('en-US',{timeZone:'America/Detroit',dateStyle:'short',timeStyle:'medium'}).format(new Date(s.saved*1000))+'.';
  message+=' '+s.buffered+' buffered · '+s.dropped+' samples not saved since restart.';
  return {...s,message};
}
function mountTracerArchive(root) {
  const panel=document.createElement('details');panel.className='history';
  panel.innerHTML='<summary>Daily readings · seven days</summary><p class="note">Saved on Tracer while this page is closed, without the cloud server. One snapshot per minute: solar watts, panel/battery volts and amps, and temperatures. Today plus the previous six days; older readings expire automatically.</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0"><input type="date" aria-label="Daily readings date"><button type="button" data-status>Refresh status</button><button type="button" data-download disabled>Download day CSV</button><button type="button" data-cancel disabled>Cancel</button></div><p data-storage role="status"></p><p data-progress role="status" aria-live="polite"></p><p class="note">CSV times are UTC; temperatures are °F. Blanks mean missing or stale readings, and gaps stay gaps. Today is partial. Saves are batched about every five minutes, so sudden power loss may lose the latest batch. Keep this section open while downloading.</p>';
  root.appendChild(panel);
  const date=panel.querySelector('input'),refresh=panel.querySelector('[data-status]'),download=panel.querySelector('[data-download]'),
    cancel=panel.querySelector('[data-cancel]'),storage=panel.querySelector('[data-storage]'),progress=panel.querySelector('[data-progress]');
  date.value=logLocalDate();
  date.max=date.value;date.min=new Date(Date.parse(date.value+'T12:00:00Z')-6*86400000).toISOString().slice(0,10);
  let state=null,busy=false,controller=null;
  const controls=()=>{date.disabled=refresh.disabled=busy;cancel.disabled=!busy;
    download.disabled=busy||!state||!state.clock||[0,2,3,6].includes(state.state);};
  const entity=async(name,signal)=>{
    const response=await fetch('/text_sensor/'+encodeURIComponent(name),{credentials:'same-origin',cache:'no-store',signal});
    if(!response.ok)throw Error('Update Tracer firmware or check its connection.');
    const x=await response.json();return JSON.parse(x.state??x.value);
  };
  async function status(){
    if(!panel.open||document.hidden||busy)return;
    try{state=tracerArchiveStatus(await entity('Tracer Archive State',AbortSignal.timeout(5000)));storage.textContent=state.message;}
    catch(error){state=null;storage.textContent=error.message;}
    controls();
  }
  panel.addEventListener('toggle',()=>{if(panel.open)status();else controller?.abort();});
  refresh.addEventListener('click',status);cancel.addEventListener('click',()=>controller?.abort());
  download.addEventListener('click',async()=>{
    if(busy||download.disabled)return;
    const chosen=date.value;if(!/^\d{4}-\d{2}-\d{2}$/.test(chosen)){progress.textContent='Choose a day.';return;}
    busy=true;controller=new AbortController();controls();progress.textContent='Preparing '+chosen+'…';
    const signal=()=>AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]);
    const token=Date.now().toString(16)+Math.floor(Math.random()*0xffffffff).toString(16),key=Number(chosen.replaceAll('-',''));
    let offset=0,start,end,rows=0,buffered=0;const parts=[];
    try{
      while(true){
        if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
        const queued=await fetch('/text/'+encodeURIComponent('Tracer Log Read')+'/set?value='+encodeURIComponent(chosen+'|'+offset+'|'+token),
          {method:'POST',credentials:'same-origin',signal:signal()});
        if(!queued.ok)throw Error('Could not request this day’s saved readings.');
        let page=null;const deadline=Date.now()+15000;
        while(Date.now()<deadline){
          if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
          await new Promise(resolve=>setTimeout(resolve,150));
          const reply=await entity('Tracer Log Page',signal());
          if(reply?.token!==token||reply?.offset!==offset)continue;
          page=parseTracerLogPage(reply,{token,offset,date:key,start,end});break;
        }
        if(!page)throw Error('Log page not confirmed. Another browser may be downloading; try again.');
        if(offset===0){parts.push(page.header);start=page.start;end=page.end;}
        parts.push(page.csv);rows+=page.rows;buffered=Math.max(buffered,page.buffered||0);offset=page.next;
        progress.textContent='Reading '+chosen+' · '+Math.round(offset/((end-start)/60)*100)+'% · '+rows+' saved snapshots';
        if(page.done)break;
      }
      if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
      const url=URL.createObjectURL(new Blob(parts,{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
      a.href=url;a.download='PawPower-Tracer-'+chosen+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      progress.textContent='Downloaded '+chosen+' · '+rows+' one-minute snapshots.'+(buffered?' Includes currently buffered readings.':'')+
        (rows?' Gaps and blank fields were preserved.':' No saved readings for this day.');
    }catch(error){progress.textContent=error.name==='AbortError'?'Download cancelled; no partial file was saved.':error.message;}
    finally{busy=false;controller=null;controls();}
  });
  controls();
}
function mountErrorLog(root,unit='PawPower') {
  const panel=document.createElement('details');panel.className='history';panel.style.marginTop='18px';
  panel.innerHTML='<summary>Error log · seven days</summary><p class="note">Local events and recoveries · today and the previous six days. Latest 32 entries per day; repeated unchanged faults are not repeated. Saved about every five minutes; sudden power loss may lose recent entries.</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0"><input type="date" aria-label="Error log day"><button type="button" data-refresh>Show / refresh</button><button type="button" data-export disabled>Download CSV</button></div><p role="status" aria-live="polite"></p><div style="overflow-x:auto"><table style="width:100%;text-align:left"><thead><tr><th>Time</th><th>Event</th></tr></thead><tbody></tbody></table></div>';
  root.appendChild(panel);
  const date=panel.querySelector('input'),refresh=panel.querySelector('[data-refresh]'),download=panel.querySelector('[data-export]'),
    feedback=panel.querySelector('[role="status"]'),body=panel.querySelector('tbody');
  const formatDate=key=>String(key).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  date.value=logLocalDate();
  let busy=false,shown=null;
  async function load(){
    if(busy||!panel.open||document.hidden)return;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date.value)){feedback.textContent='Choose a day.';return;}
    busy=true;refresh.disabled=true;download.disabled=true;shown=null;body.textContent='';
    const chosen=date.value,key=Number(chosen.replaceAll('-',''));
    const token=Date.now().toString(16)+Math.floor(Math.random()*0xffffffff).toString(16);
    feedback.textContent='Loading '+chosen+'…';
    try{
      const response=await fetch('/text/'+encodeURIComponent('Error Log Read')+'/set?value='+encodeURIComponent(chosen+'|'+token),
        {method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('Update this unit’s firmware to read its error log.');
      let model=null;
      for(let i=0;i<10;++i){
        if(!panel.open||document.hidden)throw Error('Log loading paused.');
        await new Promise(resolve=>setTimeout(resolve,1000));
        const result=await fetch('/text_sensor/'+encodeURIComponent('Error Log State'),
          {credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000)});
        if(!result.ok)throw Error('Error log unavailable. Check the unit connection.');
        const entity=await result.json(),candidate=parseErrorLog(entity.state??entity.value);
        if(candidate.token===token&&candidate.date===key){model=candidate;break;}
      }
      if(!model)throw Error('Read not confirmed. Another open page may be selecting a day; try again.');
      if(date.value!==chosen)throw Error('Day changed; select Show / refresh.');
      const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Detroit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
      for(const [time,code,value]of [...model.entries].reverse()){
        const row=document.createElement('tr'),when=document.createElement('td'),label=document.createElement('td');
        when.textContent=fmt.format(new Date(time*1000));label.textContent=errorLogLabel(code,value);
        row.append(when,label);body.appendChild(row);
      }
      feedback.textContent=chosen+' · '+model.entries.length+' retained events'+(model.omitted?' · '+model.omitted+' older events omitted by the daily limit':'')+
        (model.clock?'':' · Clock unavailable; new events cannot be dated')+(model.rollback?' · Clock moved backwards; recording paused':'')+
        (model.entries.length?'':'. No retained events for this date.')+
        (model.days.length?' · Saved days: '+[...model.days].sort().map(formatDate).join(', '):'')+' · Times: America/Detroit.';
      shown=model;download.disabled=false;
    }catch(error){feedback.textContent=error.message;}
    finally{busy=false;refresh.disabled=false;}
  }
  refresh.addEventListener('click',load);
  date.addEventListener('change',()=>{shown=null;download.disabled=true;feedback.textContent='Select Show / refresh for this day.';});
  panel.addEventListener('toggle',()=>{if(panel.open)load();});
  download.addEventListener('click',()=>{
    if(!shown)return;
    const url=URL.createObjectURL(new Blob([errorLogCsv(shown)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
    a.href=url;a.download=unit+'-Errors-'+date.value+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
}
function mountPawIcon() {
  const link=document.createElement('link');link.rel='icon';link.type='image/svg+xml';link.sizes='any';
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="16" fill="#0c141e"/><g fill="#61e4aa"><ellipse cx="16" cy="28" rx="9" ry="12"/><ellipse cx="32" cy="15" rx="9" ry="12"/><ellipse cx="52" cy="15" rx="9" ry="12"/><ellipse cx="67" cy="29" rx="9" ry="12"/><path d="M19 56C19 43 30 34 41 34S64 46 64 58C64 76 19 77 19 56Z"/></g><path d="M44 31 30 51H41L36 68 57 43H44L50 31Z" fill="#ffd23f"/></svg>';
  link.href='data:image/svg+xml,'+encodeURIComponent(svg);document.head.appendChild(link);
}

globalThis.PawPowerCommon={newPongMatch,stepPong,createPongAudio,mountPong,mountNotificationTest,mountDevicePreferences,mountAlertPreferences,alertPreferencePackets,validateAlertPreferences,encodeDeviceAlertPreferences,alertTemperatureFromWire,alertTemperatureToWire,mountEquipmentPreferences,mountPawIcon,mountErrorLog,parseErrorLog,errorLogLabel,errorLogCsv,mountTracerArchive,parseTracerLogPage,tracerArchiveStatus,equipmentView,encodeEquipmentPreferences,sameEquipmentPreferences};
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
    esphome::web_server_base::global_web_server_base->add_handler(new EnergyHistoryHandler());
    registered=true;
  }
}
}
