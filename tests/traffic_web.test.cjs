const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function harness() {
  class Element {
    constructor() {
      this.classes = new Set();
      this.classList = {add: name => this.classes.add(name), remove: name => this.classes.delete(name)};
    }
    setAttribute() {}
    insertBefore() {}
  }
  const elements = new Map(), timers = new Map();
  let now=0,serial=0;
  const get = id => {if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const context = vm.createContext({
    $: get, document: {createElement: () => new Element(),querySelector: () => new Element()},
    setTimeout: (callback,delay) => {const id=++serial;timers.set(id,{callback,at:now+delay});return id;},
    clearTimeout: id => timers.delete(id)
  });
  const source = fs.readFileSync('pawpower_shared/dashboard.js','utf8');
  const start=source.indexOf('    // Web traffic indicators');
  const end=source.indexOf('    // Display firmware',start);
  assert.ok(start>=0 && end>start);
  vm.runInContext(source.slice(start,end)+'\nglobalThis.api={receiveTraffic,clearTraffic};',context);
  return {
    receive: (counts,boot=1) => context.api.receiveTraffic({state:JSON.stringify({boot,counts})}),
    raw: state => context.api.receiveTraffic({state}),
    clear: () => context.api.clearTraffic(),
    active: i => get('traffic-'+i).classes.has('active'),
    advance: delta => {now+=delta;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.callback();}},
    pending: () => timers.size
  };
}

test('retained state initializes a quiet baseline', () => {
  const h=harness();h.receive([20,19,100,50]);
  for(let i=0;i<4;i++)assert.equal(h.active(i),false);
  assert.equal(h.pending(),0);
});
test('each changed sequence flashes its own indicator for half a second', () => {
  const h=harness();h.receive([0,0,0,0]);h.receive([1,0,0,0]);
  assert.equal(h.active(0),true);assert.equal(h.active(1),false);
  h.advance(499);assert.equal(h.active(0),true);
  h.advance(1);assert.equal(h.active(0),false);
  h.receive([1,1,1,1]);
  for(let i=1;i<4;i++)assert.equal(h.active(i),true);
});
test('duplicate snapshots do not prolong a pulse', () => {
  const h=harness();h.receive([0,0,0,0]);h.receive([0,1,0,0]);
  h.advance(400);h.receive([0,1,0,0]);h.advance(100);
  assert.equal(h.active(1),false);
});
test('new activity during a pulse renews it', () => {
  const h=harness();h.receive([0,0,0,0]);h.receive([0,0,1,0]);
  h.advance(400);h.receive([0,0,7,0]);h.advance(100);
  assert.equal(h.active(2),true);h.advance(400);assert.equal(h.active(2),false);
});
test('disconnect cancels pulses and reconnect establishes a fresh baseline', () => {
  const h=harness();h.receive([0,0,0,0]);h.receive([1,1,1,1]);h.clear();
  assert.equal(h.pending(),0);
  for(let i=0;i<4;i++)assert.equal(h.active(i),false);
  h.receive([50,50,50,50]);assert.equal(h.pending(),0);
  h.receive([51,50,50,50]);assert.equal(h.active(0),true);
});
test('device restart replaces the baseline instead of flashing old counts', () => {
  const h=harness();h.receive([10,10,10,10],1);h.receive([11,10,10,10],1);
  h.receive([0,0,0,0],2);assert.equal(h.pending(),0);
  for(let i=0;i<4;i++)assert.equal(h.active(i),false);
});
test('counter wrap is activity and malformed snapshots are ignored', () => {
  const h=harness();h.receive([0xffffffff,0,0,0]);
  h.raw('bad JSON');h.receive([-1,0,0,0]);h.receive([1,2]);
  assert.equal(h.pending(),0);
  h.receive([0,0,0,0]);assert.equal(h.active(0),true);
});
