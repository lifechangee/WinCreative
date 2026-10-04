import fs from 'fs'
const tag = process.argv[2] || 'before'
const r = JSON.parse(fs.readFileSync(`qa-brush/${tag}/metrics.json`))
const sm = r.filter((x) => x.smooth && x.tool === 'brush')
const st = sm.filter((x) => !x.taper && x.round)
const flag = (name, f, list = sm) => { const b = list.filter(f); console.log(name, b.length + '/' + list.length, b.slice(0, 14).map((x) => `${x.id}@${x.size}`).join(' ')) }
flag('aliased edges (hardFrac>0.35, size>=5, round)', (x) => x.hardFrac > 0.35 && x.eff>=5, sm.filter(x=>x.round))
flag('stair-step centroidRms>0.12 (round, no taper)', (x) => x.centroidRms > 0.12, st)
flag('ripple thicknessCv>0.05 (round,no taper,size>=5)', (x) => x.thicknessCv > 0.05 && x.eff >= 5, st)
flag('centerCv>0.05 (round,no taper,size>=5)', (x) => x.centerCv > 0.05 && x.eff>=5, st)
flag('gaps gapFrac>0', (x) => x.gapFrac > 0.02, r.filter(x=>x.smooth))
flag('startBlob>1.2', (x) => x.startBlob > 1.2, r)
flag('endBlob>1.2', (x) => x.endBlob > 1.2, r)
flag('hookDev>0.4 (round, no taper)', (x) => x.hookDev > 0.4, st)
flag('bgDiff>2', (x) => x.bgDiff > 2, r)
flag('firstInkGap>size/2+3', (x) => x.firstInkGap !== null && x.firstInkGap > x.eff / 2 + 3, sm)
flag('eraser hardFrac>0.35', (x) => x.hardFrac > 0.35 && x.eff>=5, r.filter(x=>x.tool==='eraser'))
flag('clamped size', (x) => x.eff !== x.size, r)
for (const s of [1,2,3]) { const l=sm.filter(x=>x.size===s&&x.eff===s); console.log('size',s,'mean centroidRms',(l.reduce((a,x)=>a+x.centroidRms,0)/l.length).toFixed(3),'mean edgePx',(l.reduce((a,x)=>a+x.edgePx,0)/l.length).toFixed(2)) }
