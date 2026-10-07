const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function fixture(){
  const elements=new Map();
  class Element{
    constructor(){ this.value=''; this.textContent=''; this.innerHTML=''; this.hidden=false; this.children=[]; this.style={setProperty(){}}; this.dataset={}; this.classList={add(){},remove(){},toggle(){}}; }
    appendChild(el){this.children.push(el);return el;} append(text){this.textContent+=text;} replaceChildren(){this.children=[];this.innerHTML='';}
    setAttribute(){} addEventListener(name,fn){this[name]=fn;} querySelector(){return new Element();} querySelectorAll(){return [];} focus(){} remove(){}
  }
  const node=id=>{if(!elements.has(id)) elements.set(id,new Element());return elements.get(id);};
  const tables=Object.fromEntries(['meta','messages','summaries','tasks','vectors'].map(n=>[n,new Map()]));
  const database={failNextWrite:false,transaction(names,mode){
    names=Array.isArray(names)?names:[names];
    const local=Object.fromEntries(names.map(n=>[n,new Map([...tables[n]].map(([k,v])=>[k,structuredClone(v)]))]));
    const tx={error:null}; const fail=mode==='readwrite' && this.failNextWrite; if(fail) this.failNextWrite=false;
    setImmediate(()=>{if(fail){tx.error=new Error('disk full');tx.onabort?.();return;} if(mode==='readwrite') for(const n of names) tables[n]=local[n];tx.oncomplete?.();});
    const request=value=>{const r={result:structuredClone(value)};queueMicrotask(()=>r.onsuccess?.());return r;};
    tx.objectStore=n=>({
      get:k=>request(local[n].get(k)),getAll:()=>request([...local[n].values()]),
      put:v=>{const key=v.k??v.id;local[n].set(key,structuredClone(v));return request(key);},
      add:v=>{const key=v.id??Math.max(0,...local[n].keys())+1;local[n].set(key,{...structuredClone(v),id:key});return request(key);},
      delete:k=>{local[n].delete(k);return request();},clear:()=>{local[n].clear();return request();},
      index:i=>({count:k=>request([...local[n].values()].filter(v=>v[i]===k).length),getAll:k=>request([...local[n].values()].filter(v=>v[i]===k))})
    });return tx;
  }};
  const tabs=['home','news','settings'].map(name=>{const el=new Element();el.dataset.tab=name;el.id='tab-'+name;return el;});
  const window={scrollY:0,innerHeight:800,scrolls:[],addEventListener(){},scrollTo(opts){this.scrollY=opts.top;this.scrolls.push(opts);},visualViewport:{height:800,offsetTop:0,addEventListener(name,fn){this[name]=fn;}}};
  const document={getElementById:node,createElement:()=>new Element(),querySelector:()=>new Element(),querySelectorAll:sel=>sel.includes('.tabbar')||sel==='.tab'?tabs:[],body:new Element(),documentElement:{scrollHeight:1600,style:{setProperty(){}}},addEventListener(){}};
  const context=vm.createContext({console,document,window,navigator:{onLine:true},localStorage:{getItem(){return null;},removeItem(){}},location:{reload(){}},indexedDB:{},testDB:database,URL,Blob,Map,Set,Float32Array,AbortSignal,structuredClone,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref?.();return timer;},clearTimeout,requestAnimationFrame:fn=>fn(),fetch:async()=>{throw new Error('Unexpected network request');},confirm:()=>true});
  const source=fs.readFileSync('app.js','utf8').replace(/\nboot\(\);\s*$/,'');
  vm.runInContext(source+`\ndb=testDB; globalThis.api={today,loadState,addMessage,applyAction,validateAction,validateBackup,restoreBackup,loadVectors,queueEmbed,pumpEmbed,setEmbeddings,updateEmbedStatus,semanticHits,parseBlock,geminiCall,ask,getNews,goTab,scrollChat,wire,sendChat,refreshDay,actionSnapshot,maybeSummarize,getBrief,closeDay,resetVectors,
    state:()=>S,messages:()=>MSGS,tasks:()=>TASKS,vectors:()=>VECS,busy:()=>busy,
    reset:()=>{S=structuredClone(DEFAULTS);MSGS=[];TASKS=[];SUMMARY=null;},
    setState:s=>{S={...structuredClone(DEFAULTS),...s};},setMessages:m=>{MSGS=m;},setTasks:t=>{TASKS=t;},
    setExtractor:fn=>{extractor=fn;embedReady=true;},setSummary:s=>{SUMMARY=s;},setDay:d=>{loadedDay=d;},archiveChanged:()=>{archiveGeneration++;}
  };`,context);
  return {api:context.api,node,tables,database,window,context};
}
const plain=x=>JSON.parse(JSON.stringify(x));
test('rename retains the original database and all archived task days',async()=>{
  const f=fixture();f.tables.tasks.set('yesterday',{id:'yesterday',day:'2000-01-01',title:'Old task'});
  await f.api.loadState();assert.equal(f.api.tasks().length,0);assert.equal(f.tables.tasks.size,1);
  assert.match(fs.readFileSync('app.js','utf8'),/DB_NAME='moeware'/);
  assert.equal(JSON.parse(fs.readFileSync('manifest.webmanifest','utf8')).name,'Coach');
});
test('viewport events never scroll Settings; tab positions restore independently',()=>{
  const f=fixture();f.api.wire();f.api.goTab('settings');f.window.scrollY=420;const calls=f.window.scrolls.length;
  f.window.visualViewport.resize();f.window.visualViewport.scroll();f.api.scrollChat(true);
  assert.equal(f.window.scrolls.length,calls);f.api.goTab('home');f.api.goTab('settings');assert.equal(f.window.scrollY,420);
});
test('tool updates commit atomically, clamp numbers, and leave unrelated tasks alone',async()=>{
  const f=fixture();await f.api.applyAction({tasks:[{title:'Ship pilot'}],facts:['Likes direct feedback']});
  await f.api.applyAction({tasks:[{title:'Send invoice',score:400}],completed:['Ship pilot'],goals:[{title:'Pilot',progress:200}]});
  assert.equal(f.api.tasks().length,2);assert.equal(f.api.tasks()[0].done,true);assert.equal(f.api.tasks()[1].score,10);assert.equal(f.api.state().goals[0].progress,100);
  const before=f.api.actionSnapshot();f.database.failNextWrite=true;
  await assert.rejects(f.api.applyAction({drop:['Ship pilot'],facts:['Should not persist']}),/disk full/);
  assert.equal(f.api.actionSnapshot(),before);assert.equal(f.tables.tasks.size,2);
  await assert.rejects(f.api.applyAction({tasks:[{title:'Bad',score:'NaN'}]}),/Invalid number/);
});
test('native tool round trip preserves thought signatures and returns visible receipts',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});const requests=[];
  f.context.fetch=async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body),headers:opts.headers});return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{role:'model',parts:requests.length===1?[{thoughtSignature:'keep-me',functionCall:{name:'update_coach',args:{facts:['Prefers short replies']}}}]:[{text:'Got you 💅'}]}}]})};};
  const result=await f.api.ask('coach','Remember that I prefer short replies.');
  assert.equal(result.text,'Got you 💅');assert.deepEqual(plain(result.receipts),['Saved a memory']);
  assert.equal(requests[1].body.contents.at(-2).parts[0].thoughtSignature,'keep-me');assert.equal(requests[1].body.contents.at(-1).parts[0].functionResponse.response.saved,true);
  assert.ok(requests[0].body.tools[0].functionDeclarations.length);assert.ok(!requests[0].url.includes('key='));
});
test('bad tool arguments return a tool error without modifying local data',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});let n=0;let response;
  f.context.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);if(++n===2) response=body.contents.at(-1).parts[0].functionResponse.response;return {ok:true,json:async()=>({candidates:[{content:{role:'model',parts:n===1?[{functionCall:{name:'update_coach',args:{feeds:[{name:'Unsafe',url:'javascript:alert(1)'}]}}}]:[{text:'That feed URL did not work.'}]}}]})};};
  await f.api.ask('coach','Add this feed.');assert.match(response.error,/valid URL/);assert.equal(f.api.state().feeds.length,0);
});
test('temporary model failures fall back; post-tool failures never replay on another model',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only',model:'primary',modelChain:['fallback']});let n=0;
  f.context.fetch=async()=>++n===1?{ok:false,status:503}:{ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{text:'Here for you.'}]}}]})};
  assert.equal((await f.api.ask('coach','hi')).text,'Here for you.');assert.equal(n,2);
  const g=fixture();g.api.setState({apiKey:'test-only',model:'primary',modelChain:['fallback']});let calls=0;
  g.context.fetch=async()=>++calls===1?{ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{functionCall:{name:'update_coach',args:{tasks:[{title:'Pilot'}]}}}]}}]})}:{ok:false,status:503};
  await assert.rejects(g.api.ask('coach','Plan'),/503/);assert.equal(calls,2);assert.equal(g.api.tasks().length,1);
});
test('indexing starts on the first saved message and tracks new messages without reload',async()=>{
  const f=fixture();f.api.setState({embeddings:true});f.api.setExtractor(async()=>({data:new Float32Array(384).fill(0.05)}));
  f.api.updateEmbedStatus();assert.match(f.node('embedStatus').textContent,/No conversations/);
  const m=await f.api.addMessage('me','Remember my pilot');await new Promise(setImmediate);await new Promise(r=>setTimeout(r,10));
  assert.equal(f.api.vectors().size,1);assert.equal(f.tables.vectors.size,1);assert.match(f.node('embedStatus').textContent,/1 of 1/);
  await f.api.addMessage('ai','I will remember.');await new Promise(r=>setTimeout(r,10));assert.match(f.node('embedStatus').textContent,/2 of 2/);
  await f.api.setEmbeddings(false);assert.equal((await f.api.semanticHits('pilot',5)).length,0);
  assert.equal(m.id,1);
});
test('index errors are visible and retry finishes missing vectors',async()=>{
  const f=fixture();f.api.setState({embeddings:true});f.api.setExtractor(async()=>{throw new Error('WASM unavailable');});
  await f.api.addMessage('me','test');await new Promise(r=>setTimeout(r,10));assert.match(f.node('embedStatus').textContent,/WASM unavailable/);
  f.api.setExtractor(async()=>({data:new Float32Array(384)}));f.api.queueEmbed(f.api.messages());await new Promise(r=>setTimeout(r,10));assert.equal(f.api.vectors().size,1);
});
test('backup validation rejects malformed data and preserves credentials when omitted',async()=>{
  const f=fixture();f.api.setState({apiKey:'existing-key'});await f.api.addMessage('me','Keep this');
  assert.throws(()=>f.api.validateBackup({state:{},messages:[{text:5}],tasks:[],summaries:[]}),/Invalid conversation/);
  const backup=f.api.validateBackup({state:{goals:Array.from({length:30},(_,i)=>({title:'Goal '+i}))},messages:[{id:99,role:'me',day:'2026-10-07',ts:1,text:'Restored'}],tasks:[],summaries:[]});
  assert.equal(backup.state.apiKey,'existing-key');f.database.failNextWrite=true;await assert.rejects(f.api.restoreBackup(backup),/disk full/);assert.equal(f.tables.messages.get(1).text,'Keep this');
  await f.api.restoreBackup(backup);await f.api.loadState();assert.equal(f.api.messages()[0].id,99);assert.equal(f.api.state().goals.length,30);assert.equal(f.tables.vectors.size,0);
});
test('news removes old, excluded, unsafe, and duplicate stories and balances interests',async()=>{
  const f=fixture();f.api.setState({interests:['software','design'],excludedNews:['crypto']});let count=0;
  f.context.fetch=async url=>{count++;const topic=new URL(url).searchParams.get('query');assert.equal(new URL(url).searchParams.get('restrictSearchableAttributes'),'title');return {ok:true,json:async()=>({hits:[
    {title:topic+' launch',url:'https://example.com/'+topic,created_at:new Date().toISOString(),points:100},
    {title:'crypto launch',url:'https://example.com/crypto',created_at:new Date().toISOString(),points:200},
    {title:'Old news',url:'https://example.com/old',created_at:'2000-01-01',points:300},
    {title:'Unsafe',url:'javascript:alert(1)',created_at:new Date().toISOString(),points:500},
    {title:topic+' launch',url:'https://example.com/'+topic,created_at:new Date().toISOString(),points:100},
    {title:'Mathematics of geothermal energy',url:'https://example.com/irrelevant',created_at:new Date().toISOString(),points:900}
  ]})};};
  const result=await f.api.getNews();assert.equal(result.items.length,2);assert.deepEqual(plain(result.items.map(i=>i.topic).sort()),['design','software']);await f.api.getNews();assert.equal(count,2);
});
test('user-requested reading preferences produce a receipt and invalidate news results',async()=>{
  const f=fixture();const before=f.api.actionSnapshot();await f.api.applyAction({reading_interests:['design','SaaS'],excluded_topics:['crypto']});
  assert.deepEqual(plain(f.api.state().interests),['design','SaaS']);assert.deepEqual(plain(f.api.state().excludedNews),['crypto']);assert.notEqual(before,f.api.actionSnapshot());
});
test('editorial curation chooses only real supplied articles and never receives private context',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only',interests:['software'],profile:'PRIVATE PROFILE',facts:['PRIVATE FACT'],goals:[{title:'PRIVATE GOAL'}]});f.api.setMessages([{id:1,role:'me',text:'PRIVATE CHAT',day:'2000-01-01',ts:1}]);let calls=0;
  f.context.fetch=async(url,opts)=>{
    if(!opts?.body) return {ok:true,json:async()=>({hits:[{title:'Software release',url:'https://example.com/real',created_at:new Date().toISOString(),points:30}]})};
    calls++;const body=JSON.parse(opts.body),sent=opts.body;
    for(const value of ['PRIVATE PROFILE','PRIVATE FACT','PRIVATE GOAL','PRIVATE CHAT']) assert.ok(!sent.includes(value));
    assert.equal(body.tools,undefined);assert.equal(body.generationConfig.responseMimeType,'application/json');
    return {ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{text:JSON.stringify({picks:[{id:0,why:'A useful software development.',link:'https://invented.example'},{id:0,why:'duplicate'},{id:900,why:'invented'}]})}]}}]})};
  };
  const result=await f.api.getNews();assert.equal(result.editorial,true);assert.equal(result.items.length,1);assert.equal(result.items[0].link,'https://example.com/real');assert.equal(result.items[0].reason,'A useful software development.');await f.api.getNews();assert.equal(calls,1);
});
test('editorial failure returns labelled topic matches instead of invented news',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only',interests:['software']});
  f.context.fetch=async(url,opts)=>opts?.body?{ok:false,status:503}:{ok:true,json:async()=>({hits:[{title:'Software release',url:'https://example.com/real',created_at:new Date().toISOString(),points:30}]})};
  const result=await f.api.getNews();assert.equal(result.editorial,false);assert.match(result.editorialNote,/unavailable/);assert.equal(result.items.length,1);assert.equal(result.items[0].link,'https://example.com/real');
});
test('vectors from missing IDs or incompatible models are not retrieved',async()=>{
  const f=fixture();f.api.setMessages([{id:1,text:'Current archive',ts:1,day:'2000-01-01',role:'me'}]);
  f.tables.vectors.set(1,{id:1,v:new Float32Array(20)});f.tables.vectors.set(999,{id:999,v:new Float32Array(384)});
  await f.api.loadVectors();assert.equal(f.api.vectors().size,0);
});
test('summary only covers a bounded batch that was actually sent to the model',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});
  for(let i=0;i<60;i++) await f.api.addMessage(i%2?'ai':'me','Archive message '+i);
  let submitted;
  f.context.fetch=async(url,opts)=>{submitted=JSON.parse(opts.body);return {ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{text:'{"summary":"We discussed the pilot.","facts":[]}'}]}}]})};};
  await f.api.maybeSummarize();assert.equal([...f.tables.messages.values()].filter(m=>m.s===1).length,20);assert.equal(f.tables.messages.size,60);
  assert.ok(submitted.contents[0].parts[0].text.includes('Archive message 19'));assert.ok(!submitted.contents[0].parts[0].text.includes('Archive message 20'));assert.equal(submitted.tools,undefined);
});
test('send locks before persistence so double-send creates one exchange',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});f.node('chatInput').value='Hey';
  f.context.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{text:'Hey girl 💅'}]}}]})});
  await Promise.all([f.api.sendChat(),f.api.sendChat()]);assert.equal(f.api.messages().length,2);assert.equal(f.api.busy(),false);assert.equal(f.node('sendChat').disabled,false);
});
test('a summary arriving after restore cannot overwrite the restored archive',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});
  for(let i=0;i<42;i++) await f.api.addMessage('me','Old archive '+i);
  let finish,started;const requestStarted=new Promise(r=>{started=r;});
  f.context.fetch=()=>{started();return new Promise(r=>{finish=r;});};
  const pending=f.api.maybeSummarize();await requestStarted;f.api.archiveChanged();
  await f.api.restoreBackup(f.api.validateBackup({state:{},messages:[{id:1,role:'me',text:'Restored archive',ts:1,day:'2000-01-01'}],tasks:[],summaries:[]}));await f.api.loadState();
  finish({ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{text:'{"summary":"Old summary", "facts":["Old fact"]}'}]}}]})});
  await pending;assert.equal(f.tables.messages.size,1);assert.equal(f.tables.messages.get(1).text,'Restored archive');assert.equal(f.tables.messages.get(1).s,0);assert.equal(f.tables.summaries.size,0);assert.equal(f.api.state().facts.length,0);
});
test('day rollover preserves yesterday and close-day reflection never deletes records',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});const old={id:'old',day:'2000-01-01',title:'Old'};f.tables.tasks.set(old.id,old);f.api.setTasks([old]);f.api.setDay('2000-01-01');
  await f.api.refreshDay();assert.equal(f.api.tasks().length,0);assert.equal(f.tables.tasks.size,1);
  f.context.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{text:'You showed up today. That counts.'}]}}]})});
  await f.api.closeDay();assert.equal(f.tables.tasks.size,1);assert.equal(f.api.messages().length,1);
});
test('every referenced UI id exists and no automatic morning plan runs at boot',()=>{
  const html=fs.readFileSync('index.html','utf8'), source=fs.readFileSync('app.js','utf8');const dynamic=new Set(['briefBtn','closeDay']);
  for(const match of source.matchAll(/\$\('([^']+)'\)/g)) if(!dynamic.has(match[1])) assert.ok(html.includes(`id="${match[1]}"`),'Missing '+match[1]);
  assert.ok(!source.slice(source.indexOf('async function boot')).includes('getBrief()'));
});
