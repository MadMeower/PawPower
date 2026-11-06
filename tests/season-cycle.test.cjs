const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname,'../firmware/dashboard.js'),'utf8');
const calc = source.slice(source.indexOf('  function seasonalCycle('), source.indexOf('  // End seasonal calendar calculation.'));
const ctx = vm.createContext({Date, Math, Number});
vm.runInContext(calc, ctx);
const cycle = ctx.seasonalCycle;
assert.equal(cycle('2026-11-05').days,46);
assert.equal(cycle('2026-11-05').target,'winter');
assert.equal(cycle('2026-12-20').days,1);
assert.equal(cycle('2026-12-21').event,'Winter solstice day');
assert.equal(cycle('2026-12-22').target,'summer');
assert.equal(cycle('2026-06-21').event,'Summer solstice day');
assert.equal(cycle('2026-06-22').decreasing,true);
assert.equal(cycle('2026-01-01').decreasing,false);
assert.equal(cycle('2028-02-29').days,113);
assert.equal(cycle('2026-02-29'),null);
assert.equal(cycle('bad date'),null);
for(let y=2026;y<=2030;y++) for(let m=1;m<=12;m++) {
 const r=cycle(`${y}-${String(m).padStart(2,'0')}-15`);
 assert.ok(r.days>0 && r.days<=184);
 assert.ok(Math.abs(Math.hypot(r.x-50,r.y-50)-32)<1e-9);
}
const datefn=source.slice(source.indexOf('    function michiganDate('),source.indexOf('    function michiganDate(')+500).match(/function michiganDate\(ms\) \{[\s\S]*?\n    \}/)[0];
vm.runInContext(datefn,ctx);
assert.equal(ctx.michiganDate(Date.parse('2026-11-06T02:00:00Z')),'2026-11-05');
assert.equal(ctx.michiganDate(Date.parse('2026-11-06T05:01:00Z')),'2026-11-06');
console.log('PASS: seasonal countdown, both turnarounds, year boundary, leap day, marker radius and Michigan midnight.');
