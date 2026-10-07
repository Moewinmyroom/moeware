// Moeware v2 — local-first private coach
// Everything lives on-device: IndexedDB for the long archive, localStorage-free.
// The only network calls are to Google's Gemini API (when you use the coach) and news feeds.
'use strict';

/* ==========================================================================
   1. Plumbing
   ========================================================================== */
const $ = (id) => document.getElementById(id);
const RECENT = 14;          // messages kept in the live model transcript
const SUMMARIZE_AFTER = 40; // uncovered messages before we compress
const FACT_CAP = 60;

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function today(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function fmtTime(ts){ return new Date(ts).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
function toast(msg, ms){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'), ms||2800); }

/* ==========================================================================
   2. IndexedDB
   ========================================================================== */
const DB_NAME='moeware', DB_VER=2;
let db=null;
function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=(e)=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains('meta')) d.createObjectStore('meta',{keyPath:'k'});
      if(!d.objectStoreNames.contains('messages')){
        const s=d.createObjectStore('messages',{keyPath:'id',autoIncrement:true});
        s.createIndex('ts','ts'); s.createIndex('s','s');
      }
      if(!d.objectStoreNames.contains('summaries')){
        const s=d.createObjectStore('summaries',{keyPath:'id',autoIncrement:true});
        s.createIndex('ts','ts');
      }
      if(!d.objectStoreNames.contains('tasks')) d.createObjectStore('tasks',{keyPath:'id'});
      if(!d.objectStoreNames.contains('vectors')) d.createObjectStore('vectors',{keyPath:'id'});
    };
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}
function store(name, mode){ return db.transaction(name, mode||'readonly').objectStore(name); }
function req(r){ return new Promise((res,rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
const idb={
  get:  (s,k)=>req(store(s).get(k)),
  put:  (s,v)=>req(store(s,'readwrite').put(v)),
  add:  (s,v)=>req(store(s,'readwrite').add(v)),
  del:  (s,k)=>req(store(s,'readwrite').delete(k)),
  all:  (s)=>req(store(s).getAll()),
  clear:(s)=>req(store(s,'readwrite').clear()),
  countIndex:(s,i,k)=>req(store(s).index(i).count(k)),
  getAllIndex:(s,i,k)=>req(store(s).index(i).getAll(k)),
};

/* ==========================================================================
   3. App state
   ========================================================================== */
const DEFAULTS = {
  apiKey:'', model:'gemini-3.8-flash', profile:'', goals:[], facts:[],
  feeds:[], brief:null, embeddings:false, allowProxy:false, modelChain:[],
};
let S = { ...DEFAULTS };
let MSGS = [];       // full archive (sorted by ts)
let TASKS = [];      // today's plan
let SUMMARY = null;  // latest rolling summary

async function loadState(){
  const st = await idb.get('meta','state');
  S = Object.assign({}, DEFAULTS, st||{});
  MSGS = (await idb.all('messages')).sort((a,b)=>a.ts-b.ts);
  MSGS.forEach(m=>{ m._low = m.text.toLowerCase(); });
  TASKS = await idb.all('tasks');
  TASKS = TASKS.filter(t=>t.day===today());
  const sums = await idb.all('summaries');
  SUMMARY = sums.sort((a,b)=>b.ts-a.ts)[0] || null;
}
async function saveState(){ await idb.put('meta',{k:'state',...S}); }
// One-time move from the old localStorage format, so nothing is lost.
async function migrateLegacy(){
  if(await idb.get('meta','state')) return;
  let old=null; try{ old=JSON.parse(localStorage.getItem('moeware_v1')); }catch{}
  if(!old) return;
  S = Object.assign({}, DEFAULTS, {
    apiKey:old.apiKey||'', model:old.model||DEFAULTS.model, profile:old.profile||'',
    goals:Array.isArray(old.goals)?old.goals:[], facts:Array.isArray(old.memory)?old.memory:[], feeds:[],
  });
  await saveState();
  const chat=Array.isArray(old.chat)?old.chat:[];
  let ts=Date.now()-chat.length*60000;
  for(const c of chat){ await idb.add('messages',{ ts:(ts+=60000), day:today(), role:c.r==='me'?'me':'ai', text:c.t||'', s:0 }); }
}
async function addMessage(role,text){
  const m={ ts:Date.now(), day:today(), role, text, s:0 };
  m.id = await idb.add('messages', m);
  m._low = m.text.toLowerCase();
  MSGS.push(m);
  return m;
}
async function addFact(f){
  f=String(f||'').trim(); if(!f) return;
  if(S.facts.some(x=>x.toLowerCase()===f.toLowerCase())) return;
  S.facts.push(f);
  if(S.facts.length>FACT_CAP) S.facts = S.facts.slice(-FACT_CAP);
  await saveState();
}

/* ==========================================================================
   4. Prompt (short master + separately assembled context)
   ========================================================================== */
const PERSONA = `You are Moeware — a warm, blunt, AuDHD-friendly executive coach and ruthless prioritizer for the CEO of a boutique software agency.

Rules:
- Be brief and human. No fluff, no lists of ten. Reduce choice overload.
- Lead with the single most important thing, then at most two more.
- Every task maps to a goal or is labeled MAINTENANCE.
- If effort drifts from goals, propose one small reroute that keeps the prize in view.
- Never invent names, people, or dates. If something important is missing, ask one crisp question.

You also run the app. Whenever you change the plan, goals, or memory, end your reply with ONE fenced json block, containing only the keys you are changing:
\`\`\`json
{"brief":"","tasks":[{"title":"","score":8,"goal":"","why":""}],"goals":[{"title":"","progress":50}],"facts":[""],"reroute":""}
\`\`\`
Always write the short human reply ABOVE the block.`;

function contextBlock(mode){
  const p=[];
  p.push(`DATE: ${today()} (${new Date().toLocaleDateString(undefined,{weekday:'long'})})`);
  if(S.profile) p.push(`PROFILE: ${S.profile}`);
  if(S.goals.length) p.push('GOALS:\n'+S.goals.map(g=>`- ${g.title} [${g.progress||0}%]${g.note?' — '+g.note:''}`).join('\n'));
  if(S.facts.length) p.push('DURABLE MEMORY:\n'+S.facts.map(f=>'- '+f).join('\n'));
  if(SUMMARY?.text) p.push('LONG-TERM SUMMARY (compressed history):\n'+SUMMARY.text.slice(0,1500));
  const open=TASKS.filter(t=>!t.done);
  p.push("TODAY'S OPEN TASKS:\n"+(open.length?open.map(t=>`- ${t.title} (${t.score||''}⚡${t.goal?' · '+t.goal:''})`).join('\n'):'(none yet)'));
  p.push('MODE: '+mode);
  return p.join('\n\n');
}

/* ==========================================================================
   5. Gemini — automatic fallback down the model tiers
   Try the configured model first, then the next-best tiers, until one answers.
   The model that actually replied is shown above the chat.
   ========================================================================== */
const DEFAULT_CHAIN = ['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.1-pro'];
const RETRYABLE = new Set([404,429,500,502,503,504]); // overload / rate-limit / model gone
let activeModel=null;          // last model that actually answered
let primaryCooldownUntil=0;    // after the primary 503s, skip it briefly

function chainModels(){
  const list=[];
  if(Date.now()>=primaryCooldownUntil) list.push(S.model);
  if(activeModel) list.push(activeModel);
  list.push(...((S.modelChain&&S.modelChain.length)?S.modelChain:DEFAULT_CHAIN));
  const seen=new Set(); const out=[];
  for(const m of list){ const t=String(m||'').trim(); if(t&&!seen.has(t)){ seen.add(t); out.push(t); } }
  return out;
}
function setModelLine(model, fellBack, note){
  const el=$('modelLine'); if(!el) return;
  if(!model){ el.textContent=note||''; el.hidden=!note; return; }
  el.hidden=false;
  el.innerHTML = 'via <strong>'+esc(model)+'</strong>'+(fellBack?' · fallback':'')+(note?' · '+esc(note):'');
}
async function geminiCall(model, systemText, contents){
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(S.apiKey)}`;
  const body={ systemInstruction:{parts:[{text:systemText}]}, contents, generationConfig:{temperature:0.7,maxOutputTokens:2048} };
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok){
    const err=new Error('Gemini '+r.status+': '+(await r.text()).slice(0,200));
    err.status=r.status; err.retryable=RETRYABLE.has(r.status);
    throw err;
  }
  const j=await r.json();
  return j.candidates?.[0]?.content?.parts?.map(x=>x.text).join('') || '(empty reply)';
}
async function ask(mode, prompt, opts){
  if(!S.apiKey) throw new Error('Add your Gemini API key in Settings first.');
  if(!navigator.onLine) throw new Error("You're offline. Reconnect and try again.");
  const append = !opts || opts.append !== false;
  const recalled = mode==='summarize' ? '' : await recall(prompt||'');
  const ctx = contextBlock(mode) + (recalled ? '\n\nRELEVANT FROM ARCHIVE:\n'+recalled : '');
  const systemText = PERSONA+'\n\n---\n'+ctx;
  const contents = MSGS.slice(-RECENT).map(m=>({ role: m.role==='me'?'user':'model', parts:[{text:m.text}] }));
  if(prompt && append) contents.push({ role:'user', parts:[{text:prompt}] });

  const chain=chainModels();
  let lastErr=null;
  for(let i=0;i<chain.length;i++){
    const model=chain[i];
    try{
      if(opts && opts.onTry) opts.onTry(model, i>0);
      const text=await geminiCall(model, systemText, contents);
      activeModel=model;
      if(model!==S.model) primaryCooldownUntil=Date.now()+5*60000;
      if(mode!=='summarize') setModelLine(model, model!==S.model);
      return text;
    }catch(e){
      lastErr=e;
      if(model===S.model) primaryCooldownUntil=Date.now()+5*60000;
      if(!e.retryable) throw e;
    }
  }
  throw new Error('All models are busy right now — try again in a minute. ('+(lastErr?lastErr.message:'')+')');
}
function parseBlock(txt){
  const m=txt.match(/```json([\s\S]*?)```/i);
  if(!m) return { text:txt.trim(), data:null };
  let data=null; try{ data=JSON.parse(m[1]); }catch{}
  return { text: txt.replace(m[0],'').trim(), data };
}
async function applyAction(a){
  if(!a) return;
  if(Array.isArray(a.tasks)) await setTasks(a.tasks);
  if(Array.isArray(a.goals)){
    for(const g of a.goals){
      const t=String(g.title||'').trim(); if(!t) continue;
      const f=S.goals.find(x=>x.title.toLowerCase()===t.toLowerCase());
      if(f){ if(g.progress!=null) f.progress=Math.max(0,Math.min(100,+g.progress)); if(g.note!=null) f.note=g.note; }
      else S.goals.push({ title:t, progress:g.progress||0, note:g.note||'' });
    }
    await saveState();
  }
  if(Array.isArray(a.facts)) for(const f of a.facts) await addFact(f);
  if(a.brief){ S.brief={ day:today(), text:String(a.brief) }; await saveState(); }
  renderFacts(); renderGoals();
}
async function setTasks(list){
  await idb.clear('tasks');
  TASKS = list.map(t=>({ id:uid(), day:today(), title:String(t.title||'').trim(), score:+t.score||5, goal:t.goal||'', why:t.why||'', done:false }))
               .filter(t=>t.title);
  for(const t of TASKS) await idb.put('tasks',t);
  renderPlan();
}

/* ==========================================================================
   6. Memory engine — keyword retrieval + optional local semantic embeddings
   ========================================================================== */
function tokenize(s){ return (String(s).toLowerCase().match(/[a-z0-9']{4,}/g)||[]); }
const RETRIEVAL_CUTOFF = 8000; // ignore the exchange we're answering right now

// Keyword overlap over the archive.
function keywordHits(query){
  const terms=tokenize(query); if(!terms.length) return [];
  const cutoff=Date.now()-RETRIEVAL_CUTOFF;
  const scored=[];
  for(const m of MSGS){
    if(m.ts>cutoff) continue;
    const low=m._low || (m._low=m.text.toLowerCase()); let sc=0;
    for(const t of terms){ if(low.includes(t)) sc++; }
    if(sc) scored.push({sc, m});
  }
  scored.sort((a,b)=>b.sc-a.sc || b.m.ts-a.m.ts);
  return scored.slice(0,6).map(x=>x.m);
}
function fmtHits(msgs){
  return msgs.map(m=>`[${m.day} ${m.role==='me'?'me':'coach'}] ${m.text.slice(0,240)}`).join('\n');
}
// Retrieval = semantic hits (if the local model is ready) merged with keyword hits.
async function recall(query){
  const kw = keywordHits(query);
  const sem = await semanticHits(query, 5);
  const seen=new Set(); const out=[];
  for(const m of [...sem, ...kw]){ if(!m || seen.has(m.id)) continue; seen.add(m.id); out.push(m); if(out.length>=5) break; }
  return fmtHits(out);
}

/* ==========================================================================
   6b. Local embeddings — transformers.js running on-device (WASM)
   The model downloads once (~23 MB) and is cached by the browser; after that
   everything runs offline. All text stays on the device.
   ========================================================================== */
const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
const EMBED_CDN   = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
let extractor=null, embedReady=false, embedLoading=false, embedFailed=false;
let VECS = new Map();          // message id -> Float32Array (normalized)
let embedQueue=[], embedRunning=false;

function embedStatus(html){ const el=$('embedStatus'); if(el) el.innerHTML=html; }
function renderEmbed(){
  const badge=$('embedBadge'), btn=$('embedToggle'); if(!badge||!btn) return;
  const state = embedReady?'ready' : embedFailed?'failed' : embedLoading?'loading' : (S.embeddings?'on':'off');
  badge.textContent=state;
  btn.textContent = S.embeddings ? 'Disable' : 'Enable semantic memory';
  btn.classList.toggle('primary', !S.embeddings);
}
async function loadVectors(){
  const rows = await idb.all('vectors');
  VECS = new Map(rows.map(r=>[r.id, r.v]));
  for(const m of MSGS){ if(VECS.has(m.id)) m._vec = VECS.get(m.id); }
}
async function loadEmbedder(){
  if(embedReady||embedLoading) return embedReady;
  embedLoading=true; renderEmbed(); embedStatus('Downloading model (~23 MB, once)…');
  try{
    const mod = await import(EMBED_CDN);
    mod.env.allowLocalModels = false;
    mod.env.useBrowserCache = true;
    extractor = await mod.pipeline('feature-extraction', EMBED_MODEL, { quantized:true });
    embedReady=true; embedFailed=false;
    await loadVectors();
    embedStatus('Ready. Indexing your history…');
    backfill();
  }catch(e){
    embedFailed=true; embedStatus('Could not load model ('+esc(e.message)+'). Using keyword search.');
  }
  embedLoading=false; renderEmbed();
  return embedReady;
}
async function embed(text){
  if(!embedReady||!extractor) return null;
  const out = await extractor(String(text).slice(0,1000), { pooling:'mean', normalize:true });
  return out.data;                    // Float32Array, already normalized
}
function queueEmbed(msgs){ for(const m of (msgs||[])) if(m && !m._vec) embedQueue.push(m); pumpEmbed(); }
async function pumpEmbed(){
  if(embedRunning||!embedReady) return;
  embedRunning=true;
  let n=0;
  while(embedQueue.length){
    const m=embedQueue.shift();
    try{
      const v=await embed(m.text);
      if(v){ m._vec=v; VECS.set(m.id,v); await idb.put('vectors',{ id:m.id, v }); }
    }catch{}
    if(++n%25===0) await new Promise(r=>setTimeout(r)); // let the UI breathe
  }
  embedRunning=false;
}
async function backfill(){
  const missing = MSGS.filter(m=>!m._vec && !VECS.has(m.id));
  if(missing.length) embedStatus(`Indexing ${missing.length} older messages…`);
  queueEmbed(missing);
  const wait=setInterval(()=>{
    if(!embedRunning){
      clearInterval(wait);
      embedStatus(`Indexed ${VECS.size}/${MSGS.length} messages. Semantic search is on.`);
      renderEmbed();
    }
  },1000);
}
async function semanticHits(query, k){
  if(!embedReady) return [];
  let qv; try{ qv=await embed(query); }catch{ return []; }
  if(!qv || !qv.length) return [];
  const cutoff=Date.now()-RETRIEVAL_CUTOFF;
  const scored=[];
  for(const m of MSGS){
    if(m.ts>cutoff) continue;
    const v = m._vec || VECS.get(m.id); if(!v) continue;
    let dot=0; const len=Math.min(qv.length, v.length);
    for(let i=0;i<len;i++) dot+=qv[i]*v[i];
    if(dot>0.25) scored.push({sc:dot, m});
  }
  scored.sort((a,b)=>b.sc-a.sc);
  return scored.slice(0,k).map(x=>x.m);
}
async function setEmbeddings(on){
  S.embeddings=!!on; await saveState(); renderEmbed();
  if(on && !embedReady) loadEmbedder();
  else if(on && embedReady) backfill();
}

// Compress old uncovered messages into the rolling summary + extract durable facts.
let lastSummarize=0;
async function maybeSummarize(){
  if(!S.apiKey) return;
  if(Date.now()-lastSummarize < 60000) return;
  const n = await idb.countIndex('messages','s',0);
  if(n <= SUMMARIZE_AFTER) return;
  lastSummarize=Date.now();
  const un = (await idb.getAllIndex('messages','s',0)).sort((a,b)=>a.ts-b.ts);
  const cut = un.slice(0, un.length - RECENT);        // keep the newest RECENT live
  if(cut.length < 10) return;
  const transcript = cut.map(m=>`${m.role==='me'?'Me':'Coach'} (${m.day}): ${m.text}`).join('\n');
  try{
    const raw = await ask('summarize', `Compress the older conversation below into the continuing memory.
Return ONLY a fenced json block:
\`\`\`json
{"summary":"a tight, factual long-term summary that merges any existing summary with the new events. Keep decisions, projects, people, commitments, recurring struggles. 200 words max.","facts":["at most 3 new durable facts worth remembering for a year"]}
\`\`\`
EXISTING SUMMARY:
${SUMMARY?.text || '(none)'}

OLDER CONVERSATION:
${transcript.slice(0,12000)}`);
    const { data } = parseBlock(raw);
    if(data?.summary){
      const rec={ ts:Date.now(), text:String(data.summary), fromTs:cut[0].ts, toTs:cut[cut.length-1].ts };
      rec.id=await idb.add('summaries',rec); SUMMARY=rec;
    }
    if(Array.isArray(data?.facts)) for(const f of data.facts) await addFact(f);
    for(const m of cut){ m.s=1; await idb.put('messages',m); }
  }catch(e){ /* summarization is best-effort; archive is never at risk */ }
}

/* ==========================================================================
   7. Home: brief, plan, chat
   ========================================================================== */
function renderBrief(){
  const box=$('brief');
  if(S.brief?.day===today() && S.brief.text){
    box.innerHTML=`<p class="eyebrow">Today's brief</p><div class="brief-text">${esc(S.brief.text)}</div>`;
    box.hidden=false;
  } else {
    box.innerHTML=`<p class="eyebrow">A new day</p><p class="muted">Ask the coach to set up today.</p><button id="briefBtn" class="primary">Get today's plan</button>`;
    box.hidden=false;
  }
}
function renderPlan(){
  const box=$('plan'); const open=TASKS.filter(t=>!t.done); const done=TASKS.filter(t=>t.done);
  if(!TASKS.length){ box.hidden=true; return; }
  box.hidden=false;
  const li=t=>`<li class="${t.done?'done':''}">
      <input type="checkbox" data-id="${t.id}" ${t.done?'checked':''}>
      <div class="task-main"><strong>${esc(t.title)}</strong>
        <div class="task-meta">${t.score?`<span class="score">${t.score}⚡</span>`:''}${t.goal?`<span class="pill">${esc(t.goal)}</span>`:''}${t.why?`<span class="muted">${esc(t.why)}</span>`:''}</div>
      </div>
      <button class="icon" data-del="${t.id}" aria-label="Remove">✕</button>
    </li>`;
  box.innerHTML=`<p class="eyebrow">Today's order <span class="count">${done.length}/${TASKS.length}</span></p>
    <ul class="list">${[...open,...done].map(li).join('')}</ul>
    ${done.length?`<button class="ghost" id="closeDay">Close the day →</button>`:''}`;
  box.querySelectorAll('input[type=checkbox]').forEach(cb=>cb.onchange=async()=>{
    const t=TASKS.find(x=>x.id===cb.dataset.id); t.done=cb.checked; await idb.put('tasks',t); renderPlan();
  });
  box.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    TASKS=TASKS.filter(x=>x.id!==b.dataset.del); await idb.del('tasks',b.dataset.del); renderPlan();
  });
  if($('closeDay')) $('closeDay').onclick=closeDay;
}
function msgHtml(role, text){
  const body=`<div class="msg-text">${esc(text)}</div>`;
  return role==='ai' ? body+`<button class="copy" data-copy>Copy</button>` : body;
}
function renderChat(){
  const log=$('chat'); log.innerHTML='';
  MSGS.slice(-40).forEach(m=>{
    const d=document.createElement('div');
    d.className='msg '+(m.role==='me'?'me':'ai');
    d.innerHTML=msgHtml(m.role==='me'?'me':'ai', m.text);
    log.appendChild(d);
  });
}
function scrollChat(){ requestAnimationFrame(()=>window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})); }

async function getBrief(){
  const box=$('brief');
  const b=$('briefBtn'); if(b){ b.disabled=true; b.textContent='Thinking…'; }
  try{
    const raw=await ask('brief', `It's ${new Date().toLocaleDateString(undefined,{weekday:'long'})} morning. Set up my day.
Give me a two-sentence brief in your voice, then a plan of no more than 4 needle-moving tasks (rank 1-10, mapped to a goal or MAINTENANCE). End with the json block including "brief" and "tasks".`);
    const {text,data}=parseBlock(raw);
    if(data){ await applyAction(data); }
    else if(text){ S.brief={day:today(),text}; await saveState(); }
    renderBrief();
  }catch(e){ toast(e.message,4000); renderBrief(); }
}
async function closeDay(){
  const done=TASKS.filter(t=>t.done).map(t=>t.title);
  const open=TASKS.filter(t=>!t.done).map(t=>t.title);
  toast('Closing the day…',6000);
  try{
    const raw=await ask('close-day', `I'm closing my day.
DONE: ${done.join('; ')||'nothing'}
STILL OPEN: ${open.join('; ')||'nothing'}
Update goal progress, propose a reroute if I drifted, and give me one line for tomorrow. End with the json block (goals + optional reroute + up to 3 facts).`);
    const {data}=parseBlock(raw);
    if(data) await applyAction(data);
    TASKS=[]; await idb.clear('tasks');
    S.brief=null; await saveState();
    renderPlan(); renderBrief(); renderGoals();
    toast('Day closed. Fresh start tomorrow.');
  }catch(e){ toast(e.message,4000); }
}

let busy=false;
async function deliverReply(v, meMsg, aiEl){
  try{
    const raw=await ask('coach', v, {append:false, onTry:(model,fell)=>{
      aiEl.textContent = fell ? `… trying ${model}` : '…';
      setModelLine(model, fell, 'thinking…');
    }});
    const {text,data}=parseBlock(raw);
    aiEl.classList.remove('typing'); aiEl.innerHTML=msgHtml('ai', text||'(…)');
    const aiMsg=await addMessage('ai', text||raw);
    if(data) await applyAction(data);
    await saveState();
    queueEmbed([meMsg, aiMsg]);
  }catch(e){
    aiEl.classList.remove('typing'); aiEl.innerHTML='';
    aiEl.append('⚠ '+e.message+' ');
    const retry=document.createElement('button');
    retry.className='link'; retry.textContent='Retry';
    retry.onclick=async()=>{ retry.remove(); aiEl.classList.add('typing'); aiEl.textContent='…'; scrollChat(); await deliverReply(v, meMsg, aiEl); scrollChat(); };
    aiEl.appendChild(retry);
    setModelLine(null, false, '');
  }
}
async function sendChat(){
  const inp=$('chatInput'); const v=inp.value.trim(); if(!v||busy) return;
  const msg=$('chat');
  const me=document.createElement('div'); me.className='msg me'; me.textContent=v; msg.appendChild(me);
  inp.value=''; inp.style.height='auto'; scrollChat();
  const meMsg=await addMessage('me',v);
  const ai=document.createElement('div'); ai.className='msg ai typing'; ai.textContent='…'; msg.appendChild(ai); scrollChat();
  busy=true;
  await deliverReply(v, meMsg, ai);
  busy=false; scrollChat();
  maybeSummarize();
}

/* ==========================================================================
   8. Goals + settings
   ========================================================================== */
function renderGoals(){
  const ul=$('goalList'); ul.innerHTML='';
  S.goals.forEach((g,i)=>{
    const li=document.createElement('li');
    li.innerHTML=`<div class="task-main"><strong>${esc(g.title)}</strong> <span class="pill">${g.progress||0}%</span>
        <input type="range" min="0" max="100" value="${g.progress||0}">
      </div><button class="icon" data-g="${i}">✕</button>`;
    li.querySelector('input').onchange=async e=>{ g.progress=+e.target.value; await saveState(); renderGoals(); };
    li.querySelector('[data-g]').onclick=async()=>{ S.goals.splice(i,1); await saveState(); renderGoals(); };
    ul.appendChild(li);
  });
  $('profile').value=S.profile||'';
}
function renderFacts(){
  const ul=$('factList'); ul.innerHTML='';
  S.facts.forEach((f,i)=>{
    const li=document.createElement('li');
    li.innerHTML=`<div class="task-main">${esc(f)}</div><button class="icon" data-f="${i}">✕</button>`;
    li.querySelector('[data-f]').onclick=async()=>{ S.facts.splice(i,1); await saveState(); renderFacts(); };
    ul.appendChild(li);
  });
  $('summaryPreview').textContent = SUMMARY?.text || '(nothing compressed yet)';
}
function renderFeeds(){
  $('feeds').value = (S.feeds||[]).map(f=>`${f.name} | ${f.url}`).join('\n');
  $('allowProxy').checked = !!S.allowProxy;
}
function renderSettings(){
  $('apiKey').value=S.apiKey||'';
  $('model').value=S.model;
  $('modelChain').value=(S.modelChain&&S.modelChain.length?S.modelChain:DEFAULT_CHAIN).join(', ');
  $('setupBanner').hidden=!!S.apiKey;
  renderGoals(); renderFacts(); renderFeeds(); renderEmbed();
  $('promptPreview').textContent = PERSONA + '\n\n--- sample context ---\n' + contextBlock('preview');
}

/* ==========================================================================
   9. News — no personalization, no proxies by default.
   The front page is public and query-free; RSS feeds are fetched directly from
   the source. Nothing derived from your goals, chats, or memory is sent.
   ========================================================================== */
async function fetchText(url){
  try{ const r=await fetch(url); if(r.ok) return await r.text(); }catch{}
  if(!S.allowProxy) throw new Error('this feed blocks direct reading');
  const r2=await fetch('https://api.allorigins.win/raw?url='+encodeURIComponent(url));
  if(!r2.ok) throw new Error('proxy failed');
  return await r2.text();
}
function parseFeed(xml){
  const doc=new DOMParser().parseFromString(xml,'text/xml');
  const items=[...doc.querySelectorAll('item')].slice(0,5);
  if(items.length) return items.map(it=>({
    title:(it.querySelector('title')?.textContent||'').trim(),
    link:(it.querySelector('link')?.textContent||'').trim(),
    date:(it.querySelector('pubDate')?.textContent||'').trim(),
  }));
  return [...doc.querySelectorAll('entry')].slice(0,5).map(en=>({
    title:(en.querySelector('title')?.textContent||'').trim(),
    link:(en.querySelector('link')?.getAttribute('href')||'').trim(),
    date:(en.querySelector('updated')?.textContent||'').trim(),
  }));
}
async function refreshNews(){
  const out=$('newsOut'); out.innerHTML='';

  // Front page — public, generic, sends no query about you.
  const fp=document.createElement('div'); fp.className='card';
  fp.innerHTML=`<h3>Hacker News — front page</h3><p class="muted">Loading…</p>`;
  out.appendChild(fp);
  try{
    const r=await fetch('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=8').then(r=>r.json());
    fp.innerHTML=`<h3>Hacker News — front page</h3><ul class="feed">`+
      ((r.hits||[]).map(h=>`<li><a href="${esc(h.url||'https://news.ycombinator.com/item?id='+h.objectID)}" target="_blank" rel="noopener">${esc(h.title||'')}</a> <span class="muted">· ${h.points||0}</span></li>`).join('') || '<li class="muted">No stories.</li>')+
      `</ul>`;
  }catch(e){ fp.innerHTML=`<h3>Hacker News — front page</h3><p class="muted">Couldn't load (${esc(e.message)}).</p>`; }

  // Your RSS feeds — fetched straight from the source.
  for(const f of (S.feeds||[])){
    const card=document.createElement('div'); card.className='card';
    card.innerHTML=`<h3>${esc(f.name||f.url)}</h3><p class="muted">Loading…</p>`;
    out.appendChild(card);
    try{
      const xml=await fetchText(f.url);
      const items=parseFeed(xml);
      card.innerHTML=`<h3>${esc(f.name||f.url)}</h3><ul class="feed">`+
        (items.length?items.map(i=>`<li><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a>${i.date?` <span class="muted">· ${esc(i.date)}</span>`:''}</li>`).join(''):'<li class="muted">No items.</li>')+
        `</ul>`;
    }catch(e){
      card.innerHTML=`<h3>${esc(f.name||f.url)}</h3><p class="muted">${esc(e.message)}. <a href="${esc(f.url)}" target="_blank" rel="noopener">Open feed</a> — or allow a proxy in Settings.</p>`;
    }
  }
  if(!(S.feeds||[]).length){
    out.insertAdjacentHTML('beforeend',`<div class="card"><p class="muted">Add RSS feeds in Settings. Feeds are read directly; nothing is personalized or routed through a proxy unless you turn that on.</p></div>`);
  }
}

/* ==========================================================================
   10. Tabs, wiring, PWA
   ========================================================================== */
function goTab(name){
  document.querySelectorAll('.tabbar button').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.id==='tab-'+name));
  $('composer').hidden = name!=='home';
  $('newsRefresh').hidden = name!=='news';
  window.scrollTo({top:0,behavior:'smooth'});
  if(name==='home') scrollChat();
}

function wire(){
  document.querySelectorAll('.tabbar button').forEach(b=>b.onclick=()=>goTab(b.dataset.tab));
  $('setupGo').onclick=()=>goTab('settings');

  // composer
  const inp=$('chatInput');
  inp.addEventListener('input',()=>{ inp.style.height='auto'; inp.style.height=Math.min(inp.scrollHeight,140)+'px'; });
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendChat(); } });
  $('sendChat').onclick=sendChat;

  // brief / plan (delegated because render replaces nodes)
  $('brief').addEventListener('click',e=>{ if(e.target.id==='briefBtn') getBrief(); });

  // copy a coach reply
  $('chat').addEventListener('click',e=>{
    const b=e.target.closest('[data-copy]'); if(!b) return;
    const txt=b.parentElement.querySelector('.msg-text')?.textContent||'';
    if(navigator.clipboard) navigator.clipboard.writeText(txt).then(()=>toast('Copied.'),()=>toast('Copy failed.'));
  });

  // settings
  $('saveSettings').onclick=async()=>{
    S.apiKey=$('apiKey').value.trim();
    S.model=$('model').value.trim()||'gemini-3.8-flash';
    S.modelChain=$('modelChain').value.split(',').map(s=>s.trim()).filter(Boolean);
    await saveState(); renderSettings(); toast('Saved on this device.');
  };
  $('saveProfile').onclick=async()=>{ S.profile=$('profile').value.trim(); await saveState(); toast('Profile saved.'); };
  $('addGoal').onclick=async()=>{ const v=$('goalTitle').value.trim(); if(!v) return; S.goals.push({title:v,progress:0,note:''}); $('goalTitle').value=''; await saveState(); renderGoals(); };
  $('addFact').onclick=async()=>{ const v=$('factInput').value.trim(); if(!v) return; await addFact(v); $('factInput').value=''; renderFacts(); };
  $('embedToggle').onclick=()=>{ if(!S.embeddings && !embedReady) embedStatus('Starting…'); setEmbeddings(!S.embeddings); };
  $('saveFeeds').onclick=async()=>{
    S.feeds=$('feeds').value.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{ const [name,...rest]=l.split('|'); return { name:(name||'').trim(), url:(rest.join('|')||name||'').trim() }; }).filter(f=>f.url);
    await saveState(); renderFeeds(); toast('Feeds saved.');
  };

  // archive search
  $('searchBtn').onclick=()=>{
    const q=$('searchInput').value.trim().toLowerCase(); const out=$('searchOut'); out.innerHTML='';
    if(!q){ out.innerHTML='<p class="muted">Type something to search a year of history.</p>'; return; }
    const hits=MSGS.filter(m=>m.text.toLowerCase().includes(q)).slice(-60).reverse();
    out.innerHTML = hits.length
      ? hits.map(m=>`<div class="search-hit"><span class="muted">${fmtTime(m.ts)} · ${m.role==='me'?'me':'coach'}</span><div>${esc(m.text.slice(0,400))}</div></div>`).join('')
      : '<p class="muted">No matches.</p>';
  };
  $('searchInput').addEventListener('keydown',e=>{ if(e.key==='Enter') $('searchBtn').click(); });

  // news
  $('newsRefresh').onclick=refreshNews;
  $('newsSearchBtn').onclick=()=>{ const q=$('newsSearchInput').value.trim(); if(q) window.open('https://hn.algolia.com/?q='+encodeURIComponent(q),'_blank','noopener'); };
  $('newsSearchInput').addEventListener('keydown',e=>{ if(e.key==='Enter') $('newsSearchBtn').click(); });
  $('allowProxy').onchange=async()=>{ S.allowProxy=$('allowProxy').checked; await saveState(); toast(S.allowProxy?'Proxy allowed.':'Proxy off — feeds read directly.'); };

  // data
  $('exportBtn').onclick=async()=>{
    const dump={ state:S, messages:await idb.all('messages'), summaries:await idb.all('summaries'), tasks:await idb.all('tasks'), exported:new Date().toISOString() };
    const blob=new Blob([JSON.stringify(dump,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`moeware-backup-${today()}.json`; a.click();
  };
  $('importBtn').onclick=()=>$('importFile').click();
  $('importFile').onchange=async(e)=>{
    const file=e.target.files[0]; if(!file) return;
    try{
      const dump=JSON.parse(await file.text());
      if(dump.state) { S=Object.assign({},DEFAULTS,dump.state); await saveState(); }
      if(Array.isArray(dump.messages)){ await idb.clear('messages'); for(const m of dump.messages){ const {id,...rest}=m; await idb.add('messages',rest); } }
      if(Array.isArray(dump.summaries)){ await idb.clear('summaries'); for(const m of dump.summaries){ const {id,...rest}=m; await idb.add('summaries',rest); } }
      if(Array.isArray(dump.tasks)){ await idb.clear('tasks'); for(const t of dump.tasks) await idb.put('tasks',t); }
      await loadState(); renderAll(); toast('Backup imported.');
    }catch(err){ toast('Import failed: '+err.message,4000); }
  };
  $('wipeBtn').onclick=async()=>{
    if(!confirm('Wipe ALL data on this device? This cannot be undone.')) return;
    await Promise.all([idb.clear('messages'),idb.clear('summaries'),idb.clear('tasks'),idb.clear('meta')]);
    localStorage.clear(); location.reload();
  };

  // keep composer above the mobile keyboard
  if(window.visualViewport){
    const vv=window.visualViewport;
    const fit=()=>{ document.documentElement.style.setProperty('--kb', (window.innerHeight - vv.height - vv.offsetTop) + 'px'); scrollChat(); };
    vv.addEventListener('resize',fit); vv.addEventListener('scroll',fit);
  }

  // network status
  window.addEventListener('offline',()=>toast('Offline — replies paused until you reconnect.',4000));
  window.addEventListener('online',()=>toast('Back online.'));
}

function renderAll(){ renderBrief(); renderPlan(); renderChat(); renderSettings(); }

/* ---- boot ---- */
async function boot(){
  try{ db=await openDB(); }
  catch(e){ document.body.innerHTML='<p style="padding:2rem;font-family:sans-serif">Storage unavailable. Open this over https (installed app) rather than a private window.</p>'; return; }
  await migrateLegacy();
  await loadState();
  wire();
  renderAll();
  goTab('home');
  if(S.apiKey && !(S.brief && S.brief.day===today())) getBrief();
  if(S.embeddings) setTimeout(()=>loadEmbedder(), 1200);
  // PWA updates
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').then(reg=>{
      reg.addEventListener('updatefound',()=>{
        const nw=reg.installing; if(!nw) return;
        nw.addEventListener('statechange',()=>{
          if(nw.state==='installed' && navigator.serviceWorker.controller) showUpdate(reg);
        });
      });
    }).catch(()=>{});
    let reloading=false;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(!reloading){ reloading=true; location.reload(); } });
  }
}
function showUpdate(reg){
  const t=$('toast'); t.textContent='Update ready — tap to reload';
  t.classList.add('show','action'); clearTimeout(t._h);
  t.onclick=()=>{ t.classList.remove('show'); reg.waiting?.postMessage({type:'SKIP_WAITING'}); };
}
boot();
