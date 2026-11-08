const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync('pawpower_shared/dashboard.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function newPongMatch()'), source.indexOf('  function mountPong()')) + '\nglobalThis.api={newPongMatch,stepPong,createPongAudio};', context);
const {newPongMatch,stepPong,createPongAudio} = context.api;

test('paddles stay on court and cannot teleport to pointer position', () => {
  const s=newPongMatch();stepPong(s,0.02,-10000);
  assert.ok(s.player<160 && s.player>=152);
  for(let i=0;i<100;i++)stepPong(s,0.008,-10000);
  assert.equal(s.player,34);
});
test('wall and paddle rebounds keep ball moving into court', () => {
  const s=newPongMatch();Object.assign(s,{wait:0,x:100,y:8,vy:-150});
  stepPong(s,0.02,160);assert.ok(s.vy>0);assert.ok(s.y>=7);
  Object.assign(s,{x:38,y:160,vx:-240,vy:0});
  stepPong(s,0.008,160);assert.ok(s.vx>0);assert.equal(s.donut,0);
});
test('miss scores exactly once, resets serve and ends at seven', () => {
  const s=newPongMatch();Object.assign(s,{wait:0,x:648,you:6,vx:240});
  stepPong(s,0.008,160);assert.equal(s.you,7);assert.equal(s.winner,'You win!');
  stepPong(s,0.02,160);assert.equal(s.you,7);assert.equal(s.x,320);
});
test('computer can miss and player can lose a point', () => {
  const s=newPongMatch();Object.assign(s,{wait:0,x:-8,y:300,vx:-240});
  stepPong(s,0.008,160);assert.equal(s.donut,1);assert.equal(s.you,0);assert.ok(s.wait>0);
});
test('game integration has no network calls and stops when hidden or closed', () => {
  const game=source.slice(source.indexOf('  function mountPong()'),source.indexOf('  function boot()'));
  assert.doesNotMatch(game,/fetch\(|EventSource|WebSocket|setInterval\(/);
  assert.match(game,/cancelAnimationFrame\(frame\)/);
  assert.match(game,/if\(!panel.open\)pause\(\)/);
  assert.match(game,/if\(document.hidden\)pause\(\)/);
});

test('opening is idle, start schedules frames, closing and hiding cancel them', () => {
  const events={},frames=new Map();let next=0;
  const ctx=new Proxy({}, {get:()=>()=>{},set:()=>true});
  const canvas={getContext:()=>ctx,focus(){},getBoundingClientRect:()=>({top:0,height:160})};
  const play={},reset={},score={},sound={setAttribute(){}};
  const nodes={'canvas':canvas,'#pong-play':play,'#pong-reset':reset,'#pong-score':score,'#pong-sound':sound};
  const panel={open:true,querySelector:key=>nodes[key],addEventListener:(name,fn)=>events[name]=fn};
  const document={hidden:false,createElement:()=>panel,querySelector:()=>({insertBefore(){}}),addEventListener:(name,fn)=>events[name]=fn};
  const sandbox=vm.createContext({document,window:{addEventListener:(name,fn)=>events['window-'+name]=fn},
    performance:{now:()=>0},requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)});
  vm.runInContext(source.slice(source.indexOf('  function newPongMatch()'),source.indexOf('  function boot()'))+'\nmountPong();',sandbox);
  assert.equal(frames.size,0);
  play.onclick();assert.equal(frames.size,1);assert.equal(play.textContent,'Pause game');
  panel.open=false;events.toggle();assert.equal(frames.size,0);
  panel.open=true;play.onclick();assert.equal(frames.size,1);
  document.hidden=true;events.visibilitychange();assert.equal(frames.size,0);
  reset.onclick();assert.equal(play.textContent,'Start game');assert.equal(score.textContent,'You 0 · Donut 0');
  assert.equal(frames.size,0);
});

test('paddle hits and scores emit distinct audio events only once', () => {
  const s=newPongMatch(),sounds=[];
  Object.assign(s,{wait:0,x:38,y:160,vx:-240,vy:0});
  stepPong(s,0.008,160,event=>sounds.push(event));
  stepPong(s,0.008,160,event=>sounds.push(event));
  assert.deepEqual(sounds,['hit']);
  Object.assign(s,{x:648,vx:240});stepPong(s,0.008,160,event=>sounds.push(event));
  stepPong(s,0.008,160,event=>sounds.push(event));
  assert.deepEqual(sounds,['hit','point']);
});

test('audio is lazy, mute stops tones, and pause cleans up active voices', () => {
  let constructed=0,started=0,stopped=0;
  class Audio {
    constructor(){constructed++;this.state='running';this.currentTime=0;}
    createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},disconnect(){},start(){started++;},stop(){stopped++;}};}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  const audio=createPongAudio({AudioContext:Audio});
  audio.tone('hit');assert.equal(constructed,0);assert.equal(started,0);
  audio.unlock();assert.equal(constructed,1);
  audio.tone('hit');assert.equal(started,1);
  audio.setEnabled(false);assert.equal(stopped,2);
  audio.tone('point');assert.equal(started,1);
  audio.setEnabled(true);audio.unlock();assert.equal(constructed,1);
  audio.tone('miss');assert.equal(started,2);
  audio.stop();assert.equal(stopped,4);
});

test('missing or blocked browser audio leaves the game usable', () => {
  const missing=createPongAudio({});assert.equal(missing.available,false);
  assert.doesNotThrow(()=>{missing.unlock();missing.tone('hit');missing.stop();});
  const blocked=createPongAudio({AudioContext:class {constructor(){throw Error('Blocked');}}});
  assert.doesNotThrow(()=>{blocked.unlock();blocked.tone('point');blocked.stop();});
});

test('both court edges beep and Donut meows only on the winning point', () => {
  const s=newPongMatch(),sounds=[],emit=event=>sounds.push(event);
  Object.assign(s,{wait:0,x:320,y:8,vy:-240});stepPong(s,0.008,160,emit);
  Object.assign(s,{y:312,vy:240});stepPong(s,0.008,160,emit);
  assert.deepEqual(sounds,['wall','wall']);
  Object.assign(s,{x:-8,y:300,vx:-240,donut:5});stepPong(s,0.008,160,emit);
  assert.equal(sounds.at(-1),'miss');
  Object.assign(s,{wait:0,x:-8,vx:-240});stepPong(s,0.008,160,emit);
  assert.equal(s.winner,'Donut wins!');assert.equal(sounds.at(-1),'meow');
  stepPong(s,0.008,160,emit);assert.equal(sounds.filter(x=>x==='meow').length,1);
});

test('synthesized meow glides in pitch and mute cancels it', () => {
  const pitch=[],types=[];let stops=0;
  class Audio {
    constructor(){this.state='running';this.currentTime=0;}
    createOscillator(){return {set type(v){types.push(v);},frequency:{setValueAtTime:v=>pitch.push(v),exponentialRampToValueAtTime:v=>pitch.push(v)},connect(){},disconnect(){},start(){},stop(){stops++;}};}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  const audio=createPongAudio({AudioContext:Audio});audio.unlock();audio.tone('meow');
  assert.deepEqual(types,['triangle']);assert.deepEqual(pitch,[420,820,640,210]);
  audio.setEnabled(false);assert.equal(stops,2);
  audio.tone('meow');assert.equal(types.length,1);
});
