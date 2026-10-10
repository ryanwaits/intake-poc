/**
 * Hand-check a sample of the eval set. Verdicts land in eval/data/review.json.
 *   bun run eval:review   → http://localhost:4321
 */
import { PAPERWORK } from '../src/core/form';
import { CATEGORIES, PROTOCOLS, RED_FLAGS } from '../src/core/protocols';
import { type Case, loadCases } from './case';

const REVIEW_PATH = 'eval/data/review.json';
const SAMPLE = { synthetic: 22, semigran: 8 };

type Verdict = { ok: boolean; note: string; at: string };

const covers = new Map(
  [...PAPERWORK, ...CATEGORIES.flatMap((c) => PROTOCOLS[c].history)].map((f) => [f.id, f.covers]),
);

/** Deterministic sample: every 1-in-k case, so reruns show the same set. */
function sample(cases: Case[], source: Case['source'], n: number): Case[] {
  const pool = cases.filter((c) => c.source === source);
  const step = Math.max(1, Math.floor(pool.length / n));
  return pool.filter((_, i) => i % step === 0).slice(0, n);
}

const cases = await loadCases();
const picked = [
  ...sample(cases, 'synthetic', SAMPLE.synthetic),
  ...sample(cases, 'semigran', SAMPLE.semigran),
].map((c) => ({
  id: c.id,
  source: c.source,
  reason: c.reason,
  patient: c.patient,
  style: c.meta.style ?? null,
  nearMiss: c.meta.spec?.nearMiss ?? null,
  flags: (c.labels.flags ?? []).map((f) => RED_FLAGS[f].label),
  complaints: (c.labels.complaints ?? []).map((k) => PROTOCOLS[k].label),
  fields: Object.entries(c.labels.answered ?? {}).map(([id, stated]) => ({
    id,
    covers: covers.get(id) ?? id,
    stated,
  })),
  vignette: c.meta.vignette ?? null,
}));

const file = Bun.file(REVIEW_PATH);
const verdicts: Record<string, Verdict> = (await file.exists()) ? await file.json() : {};

const server = Bun.serve({
  port: 4321,
  routes: {
    '/': () => new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    '/api/cases': () => Response.json({ cases: picked, verdicts }),
    '/api/verdict': {
      POST: async (req) => {
        const { id, ok, note } = (await req.json()) as { id: string; ok: boolean; note: string };
        verdicts[id] = { ok, note, at: new Date().toISOString() };
        await Bun.write(REVIEW_PATH, `${JSON.stringify(verdicts, null, 2)}\n`);
        return Response.json({ saved: Object.keys(verdicts).length });
      },
    },
  },
});
console.log(`Reviewing ${picked.length} cases at ${server.url}`);

const PAGE = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Label review</title>
<style>
:root{--bg:#f7f6f3;--card:#fff;--ink:#1d1c1a;--muted:#6b6862;--line:#e4e1da;--yes:#1f7a4d;--yes-bg:#e3f2e9;--no:#8a8780;--no-bg:#efede8;--flag:#b3261e;--flag-bg:#fbe7e5;--accent:#2f5bd3;--on-solid:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#151514;--card:#1e1e1c;--ink:#ecebe7;--muted:#a19e97;--line:#33322f;--yes:#6fcf97;--yes-bg:#1d3326;--no:#9a978f;--no-bg:#2a2927;--flag:#f28b82;--flag-bg:#3a1f1d;--accent:#8ab4f8;--on-solid:#111}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 80px}
header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:16px}
h1{font-size:17px;margin:0}.progress{color:var(--muted);font-variant-numeric:tabular-nums}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.tag{font-size:12px;padding:2px 8px;border-radius:99px;background:var(--no-bg);color:var(--muted)}
.tag.flag{background:var(--flag-bg);color:var(--flag)}
blockquote{margin:0 0 16px;padding:12px 16px;background:var(--bg);border-radius:6px;font-size:16px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:18px 0 8px}
table{width:100%;border-collapse:collapse}td{padding:6px 0;border-top:1px solid var(--line);vertical-align:top}
td.s{width:110px;text-align:right}.yes{color:var(--yes);background:var(--yes-bg)}.no{color:var(--no);background:var(--no-bg)}
.pill{font-size:12px;padding:2px 8px;border-radius:99px;white-space:nowrap}
details{margin-top:8px;color:var(--muted)}details p{margin:8px 0 0}
.q{margin-top:16px;color:var(--muted)}
textarea{width:100%;margin-top:12px;min-height:56px;padding:8px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit}
.actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.ok{background:var(--yes);border-color:var(--yes);color:var(--on-solid)}button.bad{background:var(--flag);border-color:var(--flag);color:var(--on-solid)}
.done{color:var(--yes);font-weight:600}.hint{color:var(--muted);font-size:13px;margin-top:10px}
</style></head><body><main>
<header><h1>Label review</h1><span class="progress" id="progress"></span></header>
<div id="app"></div>
<p class="hint">Keys: <b>y</b> labels right · <b>n</b> something's wrong (add a note) · <b>←/→</b> move</p>
</main><script>
let cases=[],verdicts={},i=0;
const $=(s)=>document.querySelector(s);
const esc=(s)=>String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function render(){
  const c=cases[i],v=verdicts[c.id];
  $('#progress').textContent=Object.keys(verdicts).length+' of '+cases.length+' checked · case '+(i+1);
  const tags=[c.source,c.style,c.patient.ageBand.replace('_',' '),c.patient.sex].filter(Boolean).map(t=>'<span class="tag">'+esc(t)+'</span>');
  c.flags.forEach(f=>tags.push('<span class="tag flag">red flag: '+esc(f)+'</span>'));
  if(c.nearMiss)tags.push('<span class="tag">near miss: '+esc(c.nearMiss)+'</span>');
  let body='<div class="meta">'+tags.join('')+'</div><blockquote>'+esc(c.reason)+'</blockquote>';
  if(c.source==='synthetic'){
    body+='<h2>Complaint</h2><div>'+esc(c.complaints.join(', '))+'</div><h2>Does the message state…</h2><table>'+
      c.fields.map(f=>'<tr><td>'+esc(f.covers)+'</td><td class="s"><span class="pill '+(f.stated?'yes">stated':'no">not stated')+'</span></td></tr>').join('')+'</table>'+
      '<p class="q">Are these labels right for the message above? Flags: is the red flag (or its absence) correct?</p>';
  }else{
    body+='<div class="meta"><span class="tag'+(c.vignette.urgency==='em'?' flag':'')+'">'+({em:'emergent',ne:'non-emergent',sc:'self-care'})[c.vignette.urgency]+'</span><span class="tag">'+esc(c.vignette.diagnosis)+'</span></div>'+
      '<details><summary>Original vignette</summary><p>'+esc(c.vignette.original)+'</p></details>'+
      '<p class="q">Is this a fair patient-voice rewrite: no exam, lab or diagnosis leaked, and the urgency still fits?</p>';
  }
  body+='<textarea id="note" placeholder="What is wrong? (optional for a yes)">'+esc(v?.note??'')+'</textarea>'+
    '<div class="actions"><button class="ok" onclick="save(true)">Labels right (y)</button><button class="bad" onclick="save(false)">Something\\'s wrong (n)</button>'+
    '<button onclick="go(-1)">← Back</button><button onclick="go(1)">Next →</button>'+(v?'<span class="done">'+(v.ok?'✓ marked right':'✗ marked wrong')+'</span>':'')+'</div>';
  $('#app').innerHTML='<div class="card">'+body+'</div>';
}
async function save(ok){
  const note=$('#note').value.trim();
  if(!ok&&!note){$('#note').focus();$('#note').placeholder='Add a short note on what is wrong, then press the button again';return}
  await fetch('/api/verdict',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:cases[i].id,ok,note})});
  verdicts[cases[i].id]={ok,note};go(1);
}
function go(d){i=Math.min(cases.length-1,Math.max(0,i+d));render()}
document.addEventListener('keydown',(e)=>{if(e.target.tagName==='TEXTAREA')return;if(e.key==='y')save(true);if(e.key==='n'){e.preventDefault();$('#note').focus()}if(e.key==='ArrowRight')go(1);if(e.key==='ArrowLeft')go(-1)});
fetch('/api/cases').then(r=>r.json()).then(d=>{cases=d.cases;verdicts=d.verdicts;i=Math.max(0,cases.findIndex(c=>!verdicts[c.id]));render()});
</script></body></html>`;
