// Moeware — local-first private coach
// Storage: localStorage only. The key never leaves this device except to Google.
const LS = 'moeware_v1';
const S = load() || { apiKey:'', model:'gemini-3.8-flash', profile:'', goals:[], tasks:[], logs:[], memory:[], chat:[] };

function load(){ try{ return JSON.parse(localStorage.getItem(LS)); }catch{ return null; } }
function save(){ localStorage.setItem(LS, JSON.stringify(S)); renderAll(); }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function today(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// ---------- Master prompt (rebuilt on every call) ----------
function stats(){
  const done = S.tasks.filter(t=>t.done).length;
  return { total:S.tasks.length, done, open:S.tasks.length-done,
    goals:S.goals.length, lastClose: S.logs.length ? S.logs[S.logs.length-1].date : 'never' };
}
function buildMasterPrompt(mode){
  const st = stats();
  return `You are Moeware, a warm, direct, AuDHD-friendly executive coach and ruthless prioritizer for the CEO of a boutique software agency.
Today is ${today()}.
PROJECT CONTEXT: ${S.profile || '(not set yet — ask one crisp question to fill the gap)'}
LONG-TERM GOALS:
${S.goals.map((g,i)=>`${i+1}. ${g.title} [${g.progress||0}%] ${g.note||''}`).join('\n') || '(none yet)'}
PROGRESS: ${st.done}/${st.total} tasks done, ${st.goals} goals, last close: ${st.lastClose}
LEAN MEMORY (durable facts only, max 20):
${S.memory.map(m=>'- '+m).join('\n') || '(empty)'}
RECENT COMPLETIONS: ${(S.logs.slice(-3).map(l=>(l.done||[]).join('; ')).join(' | ')) || '(none)'}
MODE: ${mode}
RULES:
- Be quick and conversational. Short sentences. No fluff.
- AuDHD: reduce choice overload. Always lead with the TOP 3 needle-movers.
- Every task must map to a goal or be labeled MAINTENANCE.
- If completions pull away from goals, propose a small REROUTE that keeps the prize in view.
- For ranking/reroute, end with a fenced JSON block for the app to parse, plus a short human-readable line above it.
- Memory: suggest at most 3 new durable facts, drop trivia.
- Never invent company names, people, or dates. If missing, ask.`;
}

async function gemini(userText, mode){
  if(!S.apiKey) throw new Error('Add your Gemini API key in Setup first.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${S.model}:generateContent?key=${encodeURIComponent(S.apiKey)}`;
  const body = {
    systemInstruction:{ parts:[{ text: buildMasterPrompt(mode) }] },
    contents:[{ role:'user', parts:[{ text:userText }] }],
    generationConfig:{ temperature:0.7, maxOutputTokens:2048 }
  };
  const r = await fetch(url,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  if(!r.ok) throw new Error('Gemini error '+r.status+': '+(await r.text()).slice(0,300));
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.map(p=>p.text).join('') || '(empty reply)';
}
function extractJSON(txt){
  const m = txt.match(/```json([\s\S]*?)```/i);
  if(!m) return null;
  try{ return JSON.parse(m[1]); }catch{ return null; }
}

// ---------- Today / ranking ----------
document.getElementById('rankBtn').onclick = async ()=>{
  const dump = document.getElementById('dump').value.trim();
  if(!dump) return alert('Dump something first — messy is fine.');
  const st = document.getElementById('rankStatus'); st.textContent='Thinking hard for you…';
  try{
    const reply = await gemini(`Brain dump for today:\n${dump}\n\nRank by needle-moving (score 1-10), map each item to a goal, and return JSON as {"ranked":[{"title":"...","score":9,"goal":"...","why":"..."}]} plus a short human list and a one-line pep talk.`, 'rank-today');
    const data = extractJSON(reply);
    if(data?.ranked){
      S.tasks = data.ranked.map((t,i)=>({ id:Date.now()+i, title:t.title, score:t.score||5, goal:t.goal||'—', why:t.why||'', done:false }));
      save();
      document.getElementById('dump').value='';
    } else {
      S.chat.push({r:'ai', t:reply}); save();
      alert('Ranked in the Coach tab (could not parse JSON).');
    }
    st.textContent='';
  }catch(e){ st.textContent = e.message; }
};

function renderTasks(){
  const ul = document.getElementById('taskList'); ul.innerHTML='';
  const sorted=[...S.tasks].sort((a,b)=>(b.score||0)-(a.score||0));
  sorted.forEach(t=>{
    const li=document.createElement('li'); if(t.done) li.className='done';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=!!t.done;
    cb.onchange=()=>{ t.done=cb.checked; save(); };
    const div=document.createElement('div'); div.style.flex='1';
    div.innerHTML=`<strong>${escapeHtml(t.title)}</strong><br><span class="score">${t.score||''}⚡</span> <span class="pill">${escapeHtml(t.goal||'')}</span> <span class="muted">${escapeHtml(t.why||'')}</span>`;
    const del=document.createElement('button'); del.textContent='✕'; del.onclick=()=>{ S.tasks=S.tasks.filter(x=>x.id!==t.id); save(); };
    li.append(cb,div,del); ul.appendChild(li);
  });
  const top=[...S.tasks].sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,3).filter(t=>!t.done);
  document.getElementById('top3').innerHTML = top.length
    ? '<ol>'+top.map(t=>`<li><strong>${escapeHtml(t.title)}</strong> <span class="score">${t.score}⚡</span><br><span class="muted">→ ${escapeHtml(t.goal)} · ${escapeHtml(t.why)}</span></li>`).join('')+'</ol>'
    : '<p class="muted">All clear. Nice.</p>';
}
document.getElementById('clearDone').onclick=()=>{ S.tasks=S.tasks.filter(t=>!t.done); save(); };

let mood=null;
document.querySelectorAll('[data-mood]').forEach(b=>b.onclick=()=>{
  mood=b.dataset.mood;
  document.querySelectorAll('[data-mood]').forEach(x=>x.classList.toggle('selected', x===b));
});
document.getElementById('closeDay').onclick = async ()=>{
  const done = S.tasks.filter(t=>t.done).map(t=>t.title);
  const open = S.tasks.filter(t=>!t.done).map(t=>t.title);
  const st=document.getElementById('closeStatus'); st.textContent='Updating goals + memory…';
  S.logs.push({date:today(), mood:mood||'—', done, open});
  try{
    const reply = await gemini(`Day closed. Mood:${mood}. DONE:${done.join('; ')||'none'}. STILL OPEN:${open.join('; ')||'none'}.\n1) Update each goal progress 0-100 and propose a reroute if needed. 2) Suggest at most 3 durable memories. Return JSON {"goals":[{"title":"...","progress":N}],"memories":["..."],"reroute":"..."}.`, 'close-day');
    const d = extractJSON(reply);
    if(d){
      (d.goals||[]).forEach(g=>{ const f=S.goals.find(x=>x.title.toLowerCase()===String(g.title).toLowerCase()); if(f) f.progress=g.progress; });
      (d.memories||[]).forEach(m=>{ if(m && !S.memory.includes(m)) S.memory.push(m); });
      S.memory = S.memory.slice(-20);
      if(d.reroute) S.chat.push({r:'ai',t:'Reroute: '+d.reroute});
      S.tasks = S.tasks.filter(t=>!t.done);
    }
  }catch(e){ st.textContent=e.message; return; }
  save(); st.textContent='Closed. See Goals and Coach for the reroute.';
};

// ---------- Coach chat ----------
function renderChat(){
  const log=document.getElementById('chatLog'); log.innerHTML='';
  S.chat.slice(-30).forEach(m=>{
    const d=document.createElement('div'); d.className='msg '+(m.r==='me'?'me':'ai'); d.textContent=m.t; log.appendChild(d);
  });
  log.scrollTop=log.scrollHeight;
}
async function sendChat(){
  const inp=document.getElementById('chatInput'); const v=inp.value.trim(); if(!v) return;
  S.chat.push({r:'me',t:v}); inp.value=''; save();
  S.chat.push({r:'ai',t:'…'}); renderChat();
  try{ const r=await gemini(v,'coach-chat'); S.chat[S.chat.length-1]={r:'ai',t:r}; }
  catch(e){ S.chat[S.chat.length-1]={r:'ai',t:'Error: '+e.message}; }
  save();
}
document.getElementById('sendChat').onclick=sendChat;
document.getElementById('chatInput').addEventListener('keydown',e=>{ if(e.key==='Enter') sendChat(); });

// ---------- Goals ----------
function renderGoals(){
  const ul=document.getElementById('goalList'); ul.innerHTML='';
  S.goals.forEach((g,i)=>{
    const li=document.createElement('li');
    const div=document.createElement('div'); div.style.flex='1';
    div.innerHTML=`<strong>${escapeHtml(g.title)}</strong> <span class="pill">${g.progress||0}%</span><br><span class="muted">${escapeHtml(g.note||'')}</span><br><input type="range" min="0" max="100" value="${g.progress||0}">`;
    div.querySelector('input').onchange=e=>{ g.progress=+e.target.value; save(); };
    const del=document.createElement('button'); del.textContent='✕'; del.onclick=()=>{ S.goals.splice(i,1); save(); };
    li.append(div,del); ul.appendChild(li);
  });
  document.getElementById('profile').value = S.profile||'';
}
document.getElementById('addGoal').onclick=()=>{
  const v=document.getElementById('goalTitle').value.trim(); if(!v) return;
  S.goals.push({title:v,progress:0,note:''}); document.getElementById('goalTitle').value=''; save();
};
document.getElementById('saveProfile').onclick=()=>{ S.profile=document.getElementById('profile').value.trim(); save(); };

// ---------- News (plain JS, no LLM in the fetch path) ----------
document.getElementById('refreshNews').onclick = async ()=>{
  const out=document.getElementById('newsOut');
  const qEl=document.getElementById('queries');
  let list = S.goals.map(g=>g.title).filter(Boolean).slice(0,4);
  if(!list.length && S.profile) list=[S.profile.split(/[.\n]/)[0].trim()];
  if(!list.length){ qEl.textContent='Add a goal or your project context first — the searches are built from them.'; out.innerHTML=''; return; }
  qEl.textContent='Searches: '+list.join(' · ');
  out.innerHTML='';
  for(const q of list){
    const card=document.createElement('div'); card.className='card';
    card.innerHTML=`<h3>${escapeHtml(q)}</h3><p class="muted">Loading…</p>`;
    out.appendChild(card);
    try{
      const [hn, books] = await Promise.all([
        fetch('https://hn.algolia.com/api/v1/search?query='+encodeURIComponent(q)+'&tags=story&hitsPerPage=4').then(r=>r.json()),
        fetch('https://openlibrary.org/search.json?q='+encodeURIComponent(q)+'&limit=3').then(r=>r.json()).catch(()=>null)
      ]);
      let html=`<h3>${escapeHtml(q)}</h3><ul class="feed">`;
      (hn.hits||[]).forEach(h=>{ html+=`<li><a href="${h.url||'https://news.ycombinator.com/item?id='+h.objectID}" target="_blank" rel="noopener">${escapeHtml(h.title||'')}</a> <span class="muted">· ${h.points||0}</span></li>`; });
      if(books?.docs) books.docs.forEach(b=>{ html+=`<li class="muted">Book — ${escapeHtml(b.title||'')}${(b.author_name||[])[0]?' · '+escapeHtml(b.author_name[0]):''}</li>`; });
      html+=`<li><a target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}">Watch on YouTube — ${escapeHtml(q)}</a></li></ul>`;
      card.innerHTML=html;
    }catch(e){
      card.innerHTML=`<h3>${escapeHtml(q)}</h3><p class="muted">Couldn&rsquo;t fetch (${escapeHtml(e.message)}). <a target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}">Search YouTube instead</a>.</p>`;
    }
  }
};

// ---------- Memory + settings ----------
function renderMem(){
  const ul=document.getElementById('memList'); ul.innerHTML='';
  S.memory.forEach((m,i)=>{
    const li=document.createElement('li');
    const div=document.createElement('div'); div.style.flex='1'; div.textContent=m;
    const b=document.createElement('button'); b.textContent='✕'; b.onclick=()=>{ S.memory.splice(i,1); save(); };
    li.append(div,b); ul.appendChild(li);
  });
  document.getElementById('promptPreview').textContent = buildMasterPrompt('preview');
  document.getElementById('apiKey').value = S.apiKey||'';
  document.getElementById('model').value = S.model;
  document.getElementById('setupBanner').hidden = !!S.apiKey;
}
document.getElementById('addMem').onclick=()=>{ const v=document.getElementById('memInput').value.trim(); if(!v) return; S.memory.push(v); S.memory=S.memory.slice(-20); document.getElementById('memInput').value=''; save(); };
document.getElementById('saveSettings').onclick=()=>{ S.apiKey=document.getElementById('apiKey').value.trim(); S.model=document.getElementById('model').value.trim()||'gemini-2.5-flash'; save(); alert('Saved on this device only.'); };
document.getElementById('exportBtn').onclick=()=>{ const b=new Blob([JSON.stringify(S,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='moeware-backup.json'; a.click(); };
document.getElementById('wipeBtn').onclick=()=>{ if(confirm('Wipe all data on this device?')){ localStorage.removeItem(LS); location.reload(); } };

// ---------- tabs ----------
function goTab(name){
  document.querySelectorAll('.tabbar button').forEach(x=>x.classList.toggle('active', x.dataset.tab===name));
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active', x.id==='tab-'+name));
  window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('.tabbar button').forEach(b=>b.onclick=()=>goTab(b.dataset.tab));
document.getElementById('setupGo').onclick=()=>goTab('memory');

function renderAll(){
  renderTasks(); renderChat(); renderGoals(); renderMem();
  document.getElementById('dateLine').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
}
renderAll();
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
