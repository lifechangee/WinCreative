// The `langvariants` suite of scripts/selftest.mjs: functional checks (qa-lang-logic) + the user's workflow end to end with real videos (qa-lang).
// usage: node scripts/qa/qa-lang-suite.mjs [--out out-lang]   (needs ffmpeg + ffprobe on PATH for the video part)
import { spawnSync } from 'node:child_process'
const rest = process.argv.slice(2)
let bad = 0
// the last group = independent QA (qa-langqa-*): frameless GPU capture exactness, adversarial cases, undo single step, ghost leaks, Animation Assist,
// recording exactness under fast strokes (also with rAF throttled = occluded / minimised window, rotated + mirrored views, plain documents), kill -9 recovery
for (const [s, ...extra] of [['scripts/qa/qa-lang-logic.mjs'], ['scripts/qa/qa-lang.mjs'], ['scripts/qa/qa-langqa-view.mjs'], ['scripts/qa/qa-langqa-adv.mjs'], ['scripts/qa/qa-langqa-adv.mjs', 'inf'], ['scripts/qa/qa-langqa-adv2.mjs'], ['scripts/qa/qa-langqa-anim.mjs'], ['scripts/qa/qa-langqa-fast.mjs', 'inf'], ['scripts/qa/qa-langqa-fast.mjs', 'inf', 'occluded'], ['scripts/qa/qa-langqa-fast.mjs', 'fixed', 'frame', 'occluded'], ['scripts/qa/qa-langqa-fast.mjs', 'inf', 'view', 'tilt', 'occluded'], ['scripts/qa/qa-langqa-fast.mjs', 'inf', 'plain', 'occluded'], ['scripts/qa/qa-langqa-fast.mjs', 'fixed', 'frame', 'plain', 'occluded'], ['scripts/qa/qa-langqa-fast.mjs', 'inf', 'view', 'plain'], ['scripts/qa/qa-langqa-fast.mjs', 'inf', 'view', 'plain', 'tilt', 'occluded'], ['scripts/qa/qa-langqa-kill.mjs'], ['scripts/qa/qa-tl-packinfo.mjs', '--seed', '12', '--iters', '50'], ['scripts/qa/qa-lang-leftovers.mjs']]) {
  // a launch hiccup (no check ran at all) is retried once; a real FAIL is never retried
  let r
  for (let attempt = 0; attempt < 2; attempt++) {
    r = spawnSync(process.execPath, [s, ...rest, ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 })
    const text = (r.stdout ?? '') + (r.stderr ?? '')
    if (r.status === 0 || /^FAIL /m.test(text) || /^PASS /m.test(text)) break
    console.log('(no check ran, retrying once) ' + text.slice(0, 300))
  }
  process.stdout.write(r.stdout ?? '')
  process.stdout.write(r.stderr ?? '')
  if (r.status !== 0) bad++
}
process.exit(bad ? 1 : 0)
