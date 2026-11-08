const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

// Exercise the real SD panel code with a DOM stub, without a network or device.
function harness() {
  class Element {
    constructor() { this.children = []; this.disabled = false; this.hidden = false; this.value = ''; }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    insertBefore(child) { this.children.push(child); }
    click() { this.clicked = true; }
    remove() { this.removed = true; }
    setAttribute(name,value) { (this.attributes ||= {})[name] = value; }
    getBoundingClientRect() { return {left:0,width:900}; }
  }
  const elements = new Map(), main = new Element(), calls = [];
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const context = vm.createContext({
    document: {createElement: () => new Element(), querySelector: () => main, body: main},
    $: get, transport: true, AbortSignal,
    michiganDate: () => '2026-11-07', Blob,
    URL: {createObjectURL: () => 'blob:test-download', revokeObjectURL: () => {}},
    setTimeout: callback => { callback(); return 1; },
    fetch: async (...args) => { calls.push(args); return {ok: true}; }
  });
  const source = fs.readFileSync('pawpower_shared/dashboard.js', 'utf8');
  const helperStart=source.indexOf('  // Minute history helpers.');
  const helperEnd=source.indexOf('  // End minute history helpers.',helperStart);
  vm.runInContext(source.slice(helperStart,helperEnd),context);
  const start = source.indexOf('    // Display firmware announces');
  const end = source.indexOf('    let seasonDate', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.api = {receiveSd, sdAction, renderHistoryGraphs, parseMinuteHistory};', context);
  const receive = state => context.api.receiveSd({state: JSON.stringify(state)});
  return {context, main, get, calls, receive};
}

test('SD panel stays hidden on boards without SD diagnostics', () => {
  const h = harness();
  assert.equal(h.main.children[0].hidden, true);
});

test('filenames render as text, including HTML characters and Unicode', () => {
  const h = harness(), name = '<img src=x onerror=alert(1)> café.csv';
  h.receive({mounted: true, busy: false, capacity_mb: 8192, message: 'Ready', files: [
    {name, directory: false, bytes: 123}, {name: 'Logs', directory: true, bytes: 0}
  ]});
  assert.equal(h.main.children[0].hidden, false);
  const rows = h.get('sd-files').children;
  assert.equal(rows[0].children[0].textContent, name);
  assert.equal(rows[0].children[0].innerHTML, undefined);
  assert.equal(rows[1].children[1].textContent, 'Folder');
  assert.equal(h.get('sd-test').disabled, false);
});

test('missing card, busy state and truncated listings are explicit', () => {
  const h = harness();
  h.receive({mounted: false, busy: false, message: 'Mount failed', files: []});
  assert.equal(h.get('sd-test').disabled, true);
  assert.equal(h.get('sd-refresh').disabled, false);
  assert.equal(h.get('sd-files').children[0].children[0].textContent, 'Card unavailable');
  h.receive({mounted: true, busy: true, truncated: true, files: []});
  assert.equal(h.get('sd-refresh').disabled, true);
  assert.match(h.get('sd-status').textContent, /Listing limited/);
});

test('write test requires a deliberate click and sends only its button request', async () => {
  const h = harness();
  h.receive({mounted: true, busy: false, files: []});
  assert.equal(h.calls.length, 0);
  await h.context.api.sdAction(true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], '/button/SD%20Card%20Write%20Test/press');
  assert.equal(h.calls[0][1].method, 'POST');
  assert.equal(h.calls[0][1].credentials, 'same-origin');
});

test('offline and busy requests do not start a card operation', async () => {
  const h = harness();
  h.receive({mounted: true, busy: true, files: []});
  await h.context.api.sdAction(true);
  h.receive({mounted: true, busy: false, files: []});
  h.context.transport = false;
  await h.context.api.sdAction(false);
  assert.equal(h.calls.length, 0);
});

test('HTTP failure is reported and permits retry', async () => {
  const h = harness();
  h.receive({mounted: true, busy: false, files: []});
  h.context.fetch = async () => ({ok: false, status: 500});
  await h.context.api.sdAction(false);
  assert.match(h.get('sd-status').textContent, /HTTP 500/);
  assert.equal(h.get('sd-refresh').disabled, false);
});

test('erase requires exact typed confirmation and an available card', async () => {
  const h = harness();
  h.receive({mounted: true, busy: false, revision: 1, files: []});
  for (const token of ['', 'erase', 'ERAS', ' ERASE']) {
    h.get('sd-erase-confirm').value = token;
    h.get('sd-erase-confirm').oninput();
    assert.equal(h.get('sd-erase').disabled, true);
    await h.context.api.sdAction(false, true);
  }
  h.receive({mounted: false, busy: false, revision: 2, files: []});
  h.get('sd-erase-confirm').value = 'ERASE';
  await h.context.api.sdAction(false, true);
  assert.equal(h.calls.length, 0);
});

test('confirmed erase sends one explicit command and consumes confirmation', async () => {
  const h = harness();
  h.receive({mounted: true, busy: false, revision: 1, files: []});
  h.get('sd-erase-confirm').value = 'ERASE';
  h.get('sd-erase-confirm').oninput();
  assert.equal(h.get('sd-erase').disabled, false);
  await h.get('sd-erase').onclick();
  assert.equal(h.calls[0][0], '/text/SD%20Card%20Erase/set?value=ERASE');
  assert.equal(h.calls[0][1].method, 'POST');
  assert.equal(h.get('sd-erase-confirm').value, '');
  assert.equal(h.get('sd-refresh').disabled, true);
  assert.equal(h.get('sd-erase').disabled, true);
  await h.get('sd-erase').onclick();
  await h.context.api.sdAction(false);
  assert.equal(h.calls.length, 1);
  // Even an identical result has a new operation revision from the worker.
  h.receive({mounted: true, busy: false, revision: 2, files: [], message: 'ERASE COMPLETE'});
  assert.equal(h.get('sd-refresh').disabled, false);
  assert.equal(h.get('sd-erase').disabled, true);
});

test('cancel clears erase confirmation without a device request', () => {
  const h = harness();
  h.receive({mounted: true, busy: false, files: []});
  h.get('sd-erase-confirm').value = 'ERASE';
  h.get('sd-erase-confirm').oninput();
  h.get('sd-erase-cancel').onclick();
  assert.equal(h.get('sd-erase-confirm').value, '');
  assert.equal(h.get('sd-erase').disabled, true);
  assert.equal(h.calls.length, 0);
});

test('mounted partition free space is separate from raw card capacity', () => {
  const h = harness();
  h.receive({mounted: true, busy: false, capacity_mb: 15304,
    total_bytes: 104857600, free_bytes: 73400320, files: []});
  assert.match(h.get('sd-space').textContent, /30 MiB used/);
  assert.match(h.get('sd-space').textContent, /70 MiB free/);
  assert.match(h.get('sd-space').textContent, /100 MiB total/);
});

test('minute recorder status distinguishes saved and dropped minutes', () => {
  const h = harness();
  h.receive({mounted: true, busy: false, files: [], logging: 'Recording paused: card full', rows_written: 100, dropped_minutes: 2});
  assert.match(h.get('sd-recording').textContent, /card full/);
  assert.match(h.get('sd-recording').textContent, /100 rows saved/);
  assert.match(h.get('sd-recording').textContent, /2 minutes not saved/);
});

test('CSV download collects bounded chunks and produces the complete daily file', async () => {
  const h = harness();
  h.receive({mounted: true, busy: false, revision: 1, files: []});
  const csv = 'utc_start,coverage_s\n2026-11-07T12:00:00Z,60\n';
  let request, blob, revision = 1, chunks = 0;
  h.context.URL.createObjectURL = value => { blob = value; return 'blob:csv'; };
  h.context.fetch = async (url, options) => {
    if (options.method === 'POST') {
      assert.match(url, /^\/text\/SD%20Log%20Read\/set\?value=/);
      const [date, position, token] = new URL(url, 'http://device').searchParams.get('value').split('|');
      request = {date, offset: Number(position), token};
      chunks++;
      return {ok: true};
    }
    return {ok: true, json: async () => ({state: JSON.stringify({mounted: true, busy: false, files: [], revision: ++revision,
      export: {...request, size: csv.length, data: csv.slice(request.offset, request.offset + 7), error: ''}})})};
  };
  await h.get('sd-download').onclick();
  assert.ok(chunks > 1);
  assert.equal(await blob.text(), csv);
  assert.match(h.get('sd-download-status').textContent, /Downloaded PawPower-2026-11-07.csv/);
  assert.equal(h.main.children.at(-1).download, 'PawPower-2026-11-07.csv');
  assert.equal(h.get('sd-refresh').disabled, false);
});

test('CSV download reports an unavailable date without producing a file', async () => {
  const h = harness();
  h.receive({mounted: true, busy: false, revision: 1, files: []});
  let request, created = false;
  h.context.URL.createObjectURL = () => { created = true; return 'blob:unexpected'; };
  h.context.fetch = async (url, options) => {
    if (options.method === 'POST') {
      const [date, offset, token] = new URL(url, 'http://device').searchParams.get('value').split('|');
      request = {date, offset: Number(offset), token}; return {ok: true};
    }
    return {ok: true, json: async () => ({state: JSON.stringify({mounted: true, busy: false, revision: 2, files: [],
      export: {...request, error: 'Daily CSV not available'}})})};
  };
  await h.get('sd-download').onclick();
  assert.equal(created, false);
  assert.match(h.get('sd-download-status').textContent, /Daily CSV not available/);
  assert.equal(h.get('sd-download').disabled, false);
});

test('missing-data graphs stay empty and do not claim zero measured energy', () => {
  const h=harness();
  const csv='utc_start,local_start,coverage_s,quality,soc_pct,volts,amps,watts,charged_wh,discharged_wh\n'+
    '2026-11-07T16:21:00Z,2026-11-07T11:21:00,0,missing,,,,,,\n';
  h.context.api.renderHistoryGraphs(h.context.api.parseMinuteHistory(csv,'2026-11-07'));
  assert.match(h.get('history-summary').textContent,/No measured energy/);
  assert.match(h.get('history-power').innerHTML,/No valid readings recorded/);
  assert.doesNotMatch(h.get('history-power').innerHTML,/<circle/);
  assert.match(h.get('history-hover').textContent,/Missing readings/);
});

test('recorded power/SOC plot and inspect without changing device controls', () => {
  const h=harness();
  const csv='utc_start,local_start,coverage_s,quality,soc_pct,volts,amps,watts,charged_wh,discharged_wh\n'+
    '2026-11-07T16:21:00Z,2026-11-07T11:21:00,60,complete,75,50,10,500,8.333333,0\n'+
    '2026-11-07T16:22:00Z,2026-11-07T11:22:00,60,complete,74,50,-10,-500,0,8.333333\n';
  h.context.api.renderHistoryGraphs(h.context.api.parseMinuteHistory(csv,'2026-11-07'));
  assert.match(h.get('history-power').innerHTML,/clip-path="url\(#history-positive\)"/);
  assert.match(h.get('history-power').innerHTML,/stroke="#ff7979"/);
  assert.doesNotMatch(h.get('history-power').innerHTML,/NaN|Infinity/);
  assert.match(h.get('history-hover').textContent,/75.0% SOC/);
  h.get('history-soc').onkeydown({key:'ArrowRight',preventDefault(){}});
  assert.match(h.get('history-hover').textContent,/-0.50 kW.*74.0% SOC/);
  assert.equal(h.calls.length,0);
});

test('Show graphs reads the selected daily CSV through the shared reader', async () => {
  const h=harness();h.receive({mounted:true,busy:false,revision:1,files:[]});
  const csv='utc_start,local_start,coverage_s,quality,soc_pct,volts,amps,watts,charged_wh,discharged_wh\n'+
    '2026-11-07T16:21:00Z,2026-11-07T11:21:00,0,missing,,,,,,\n';
  let request, revision=1;
  h.context.fetch=async (url,options)=>{
    if(options.method==='POST'){
      const [date,offset,token]=new URL(url,'http://device').searchParams.get('value').split('|');
      request={date,offset:Number(offset),token};return {ok:true};
    }
    return {ok:true,json:async()=>({state:JSON.stringify({mounted:true,busy:false,files:[],revision:++revision,
      export:{...request,size:csv.length,data:csv.slice(request.offset,request.offset+80),error:''}})})};
  };
  await h.get('history-load').onclick();
  assert.match(h.get('history-load-status').textContent,/Loaded 2026-11-07/);
  assert.match(h.get('history-summary').textContent,/No measured energy/);
  assert.match(h.get('history-power').innerHTML,/No valid readings/);
  assert.equal(h.get('history-load').disabled,false);
});

test('a failed graph load clears prior plots and their inspection handlers', async () => {
  const h=harness();h.receive({mounted:true,busy:false,revision:1,files:[]});
  const csv='utc_start,local_start,coverage_s,quality,soc_pct,volts,amps,watts,charged_wh,discharged_wh\n'+
    '2026-11-07T16:21:00Z,2026-11-07T11:21:00,60,complete,75,50,10,500,8,0\n';
  h.context.api.renderHistoryGraphs(h.context.api.parseMinuteHistory(csv,'2026-11-07'));
  h.context.fetch=async()=>({ok:false,status:404});
  await h.get('history-load').onclick();
  assert.match(h.get('history-load-status').textContent,/Graph load failed/);
  assert.equal(h.get('history-power').innerHTML,'');
  assert.equal(h.get('history-power').onpointermove,null);
  assert.equal(h.get('history-soc').onkeydown,null);
});
