const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync('pawpower_shared/dashboard.js','utf8');
const start=source.indexOf('  // Minute history helpers.');
const end=source.indexOf('  // End minute history helpers.',start);
const context=vm.createContext({});
vm.runInContext(source.slice(start,end)+'\nglobalThis.api={historyDayBounds,parseMinuteHistory,historyRuns};',context);
const {historyDayBounds,parseMinuteHistory,historyRuns}=context.api;
const header='utc_start,local_start,coverage_s,quality,soc_pct,volts,amps,watts,charged_wh,discharged_wh\n';
const row=(minute,quality='complete',watts=500)=>{
  const utc=new Date(Date.parse('2026-11-07T05:00:00Z')+minute*60000).toISOString().replace('.000Z','Z');
  return quality==='missing'?`${utc},2026-11-07T00:00:00,0,missing,,,,,,\n`:
    `${utc},2026-11-07T00:00:00,${quality==='complete'?60:20},${quality},50,50,10,${watts},${watts>0?watts/60:0},${watts<0?-watts/60:0}\n`;
};
test('Michigan day boundaries handle normal, spring and fall days',()=>{
  for(const [date,hours] of [['2026-11-07',24],['2026-03-08',23],['2026-11-01',25]]){
    const b=historyDayBounds(date);assert.equal((b.end-b.start)/3600000,hours);
  }
  assert.throws(()=>historyDayBounds('2026-02-30'));
});
test('missing cells remain missing rather than numeric zeros',()=>{
  const m=parseMinuteHistory(header+row(0,'missing'),'2026-11-07');
  assert.equal(m.validCount,0);assert.equal(m.missingCount,1);assert.equal(m.rows[0].soc,null);
  assert.equal(historyRuns(m).length,0);
});
test('measured idle zero values are valid',()=>{
  const m=parseMinuteHistory(header+row(0,'complete',0),'2026-11-07');
  assert.equal(m.validCount,1);assert.equal(m.rows[0].watts,0);assert.equal(m.chargedWh,0);
});
test('recorded charge/discharge totals use the CSV Wh columns',()=>{
  const m=parseMinuteHistory(header+row(0,'complete',600)+row(1,'complete',-1200),'2026-11-07');
  assert.equal(m.chargedWh,10);assert.equal(m.dischargedWh,20);assert.equal(m.coverage,120);
});
test('gaps and partial records split paths instead of interpolating',()=>{
  const csv=header+row(0)+row(1)+row(2,'missing')+row(3)+row(4)+row(6)+row(7,'partial')+row(8)+row(9);
  const m=parseMinuteHistory(csv,'2026-11-07');
  assert.deepEqual(Array.from(historyRuns(m),run=>run.length),[2,2,1,1,2]);
  assert.equal(m.partialCount,1);
});
test('duplicate timestamps replace prior rows without double-counting energy',()=>{
  const m=parseMinuteHistory(header+row(0,'complete',600)+row(0,'complete',1200),'2026-11-07');
  assert.equal(m.duplicates,1);assert.equal(m.rows.length,1);assert.equal(m.chargedWh,20);
});
test('malformed rows and interrupted trailing appends are skipped',()=>{
  const bad=row(1).replace(',50,50,10,',',,50,10,');
  const m=parseMinuteHistory(header+row(0)+bad+row(2).trimEnd(),'2026-11-07');
  assert.equal(m.rows.length,1);assert.equal(m.invalid,2);
  assert.throws(()=>parseMinuteHistory('wrong header\n','2026-11-07'));
});
test('rows from another day cannot affect the selected day',()=>{
  const m=parseMinuteHistory(header+row(-1)+row(0),'2026-11-07');
  assert.equal(m.rows.length,1);assert.equal(m.invalid,1);
});
