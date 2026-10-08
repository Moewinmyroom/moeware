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
  const tables=Object.fromEntries(['meta','messages','summaries','tasks','vectors','backups'].map(n=>[n,new Map()]));
  const database={failNextWrite:false,transaction(names,mode){
    names=Array.isArray(names)?names:[names];
    const local=Object.fromEntries(names.map(n=>[n,new Map([...tables[n]].map(([k,v])=>[k,structuredClone(v)]))]));
    const tx={error:null,abort(){fail=true;}}; let fail=mode==='readwrite' && this.failNextWrite; if(fail) this.failNextWrite=false;
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
  const tabs=['home','news','stuff','people','settings'].map(name=>{const el=new Element();el.dataset.tab=name;el.id='tab-'+name;return el;});
  const window={scrollY:0,innerHeight:800,scrolls:[],addEventListener(){},scrollTo(opts){this.scrollY=opts.top;this.scrolls.push(opts);},visualViewport:{height:800,offsetTop:0,addEventListener(name,fn){this[name]=fn;}}};
  const document={getElementById:node,createElement:()=>new Element(),querySelector:()=>new Element(),querySelectorAll:sel=>sel.includes('.tabbar')||sel==='.tab'?tabs:[],body:new Element(),documentElement:{scrollHeight:1600,style:{setProperty(){}}},addEventListener(){}};
  const context=vm.createContext({console,document,window,navigator:{onLine:true},localStorage:{getItem(){return null;},removeItem(){}},location:{reload(){}},indexedDB:{},testDB:database,URL,Blob,Map,Set,Float32Array,AbortSignal,structuredClone,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref?.();return timer;},clearTimeout,requestAnimationFrame:fn=>fn(),fetch:async()=>{throw new Error('Unexpected network request');},confirm:()=>true});
  const source=fs.readFileSync('app.js','utf8').replace(/\nboot\(\);\s*$/,'');
  vm.runInContext(source+`\ndb=testDB; globalThis.api={today,loadState,addMessage,applyAction,validateAction,validateBackup,restoreBackup,loadVectors,queueEmbed,pumpEmbed,setEmbeddings,updateEmbedStatus,semanticHits,parseBlock,geminiCall,ask,getNews,goTab,scrollChat,wire,sendChat,refreshDay,actionSnapshot,maybeSummarize,getBrief,closeDay,resetVectors,contextBlock,searchMemory,todaysTasks,activeTasks,rankedTasks,morningRequest,automaticBackup,backupDump,savePersonalization,wirePersonalization,sendPersona,renderPeople,searchReadingWeb,groundedResult,deleteContext,
    selectPerson:id=>{selectedPersonId=id;},
    state:()=>S,messages:()=>MSGS,tasks:()=>TASKS,vectors:()=>VECS,busy:()=>busy,
    reset:()=>{S=structuredClone(DEFAULTS);MSGS=[];TASKS=[];SUMMARY=null;SUMMARIES=[];},
    setState:s=>{S={...structuredClone(DEFAULTS),...s};},setMessages:m=>{MSGS=m;},setTasks:t=>{TASKS=t;},
    setExtractor:fn=>{extractor=fn;embedReady=true;},setSummary:s=>{SUMMARY=s;},setDay:d=>{loadedDay=d;},archiveChanged:()=>{archiveGeneration++;}
  };`,context);
  return {api:context.api,node,tables,database,window,context};
}
const plain=x=>JSON.parse(JSON.stringify(x));

test('editable master prompt survives reload and reaches the next request without the old persona',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});f.api.wirePersonalization();
  f.node('masterPrompt').value='Be my concise, funny brainstorming friend.';await f.node('saveMasterPrompt').onclick();await f.api.loadState();
  let body;f.context.fetch=async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'Got it.'}]}}]})};};
  await f.api.ask('coach','Hello');assert.ok(body.systemInstruction.parts[0].text.startsWith('Be my concise, funny brainstorming friend.'));
  assert.ok(!body.systemInstruction.parts[0].text.includes("You're my smart, funny friend"));
  await f.node('resetMasterPrompt').onclick();assert.equal(f.api.state().masterPrompt,null);assert.ok(f.node('masterPrompt').value.split(/\s+/).length<90);
  f.database.failNextWrite=true;await assert.rejects(f.api.savePersonalization({masterPrompt:'Must not persist'}));assert.equal(f.api.state().masterPrompt,null);
});

test('fictional chats keep separate histories and cannot write ordinary memory or tasks',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only',profile:'PRIVATE PROFILE',people:[{id:'one',name:'Example Founder',notes:'Direct feedback'},{id:'two',name:'Another Person',notes:''}],personaChats:[{personId:'two',role:'me',text:'OTHER PERSON CHAT',ts:1}]});
  await f.api.addMessage('me','PRIVATE COACH CHAT');f.api.selectPerson('one');f.node('personaInput').value='How would you test my idea?';
  let body;f.context.fetch=async(url,opts)=>{body=JSON.parse(opts.body);assert.ok(!opts.body.includes('PRIVATE'));assert.ok(!opts.body.includes('OTHER PERSON CHAT'));return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'Try a tiny experiment.'}]}}]})};};
  await f.api.sendPersona();assert.equal(body.tools,undefined);assert.match(body.systemInstruction.parts[0].text,/fictional roleplay/);
  assert.equal(f.api.messages().length,1);assert.equal(f.api.state().personaChats.length,3);assert.equal(f.api.tasks().length,0);
  await f.api.loadState();assert.equal(f.api.state().personaChats.length,3);
  f.context.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{functionCall:{name:'update_coach',args:{tasks:[{title:'Invented obligation'}]}}}]}}]})});
  await assert.rejects(f.api.geminiCall('model','fictional',[],'persona'),/Unexpected tool/);assert.equal(f.api.tasks().length,0);
});

test('web roundups use chosen interests and people, require source grounding, and exclude private context',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only',profile:'PRIVATE PROFILE',masterPrompt:'PRIVATE PROMPT',people:[{id:'p',name:'Example Founder',notes:'PRIVATE NOTES'}],personaChats:[{personId:'p',role:'me',text:'PRIVATE ROLEPLAY',ts:1}],interests:['newsletters','marketing']});
  f.api.setMessages([{id:1,role:'me',day:'2000-01-01',ts:1,text:'PRIVATE CHAT'}]);
  f.context.fetch=async(url,opts)=>{assert.ok(!opts.body.includes('PRIVATE'));const body=JSON.parse(opts.body);assert.deepEqual(body.tools,[{google_search:{}}]);assert.match(opts.body,/Example Founder/);assert.match(opts.body,/newsletters/);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'A useful read.'}]},groundingMetadata:{groundingChunks:[{web:{title:'Original source',uri:'https://example.com/article'}}],groundingSupports:[{segment:{endIndex:14},groundingChunkIndices:[0,99]}]}}]})};};
  const result=await f.api.searchReadingWeb();assert.match(result.text,/\[1\]\(https:\/\/example.com\/article\)/);assert.equal(result.sources.length,1);assert.ok(!result.text.includes('[100]'));
  assert.throws(()=>f.api.groundedResult({content:{parts:[{text:'Invented article'}]}}),/source-backed/);
  assert.throws(()=>f.api.groundedResult({content:{parts:[{text:'Bad source'}]},groundingMetadata:{groundingChunks:[{web:{uri:'javascript:alert(1)'}}],groundingSupports:[{segment:{endIndex:5},groundingChunkIndices:[0]}]}}),/source-backed/);
});

test('dated history deletion removes linked records and derived copies atomically, retaining unrelated context',async()=>{
  const f=fixture();await f.api.addMessage('me','Remove this');await f.api.applyAction({tasks:[{title:'Linked task'}],goals:[{title:'Linked goal'}],memories:[{key:'linked',text:'Linked memory'}]});
  const old=f.api.messages()[0];old.day='2025-01-01';await f.tables.messages.set(old.id,plain(old));
  await f.api.addMessage('me','Keep this');await f.api.applyAction({memories:[{key:'retained',text:'Retained memory'}]});
  f.tables.summaries.set(1,{id:1,text:'Remove this summary',ts:1});f.tables.vectors.set(1,{id:1,v:[1]});await f.api.automaticBackup();
  await f.api.deleteContext({history:true,from:'2025-01-01',to:'2025-01-01'});
  assert.equal(f.api.messages().length,1);assert.equal(f.api.messages()[0].text,'Keep this');assert.equal(f.api.messages()[0].s,0);
  assert.equal(f.api.tasks().length,0);assert.equal(f.api.state().goals.length,0);assert.deepEqual(plain(f.api.state().facts),['Retained memory']);
  for(const table of ['summaries','vectors','backups'])assert.equal(f.tables[table].size,0);
  assert.ok(!f.api.contextBlock('coach').includes('Linked memory'));assert.equal((await f.api.searchMemory({query:'Remove this'})).exchanges,'');
});

test('failed deletion preserves persisted and in-memory context, including recovery snapshots',async()=>{
  const f=fixture();await f.api.addMessage('me','Keep me');await f.api.applyAction({memories:[{key:'test',text:'Important memory'}]});await f.api.automaticBackup();
  f.database.failNextWrite=true;await assert.rejects(f.api.deleteContext({all:true}),/original data was kept/);
  assert.equal(f.api.messages()[0].text,'Keep me');assert.equal(f.tables.messages.size,1);assert.equal(f.tables.backups.size,1);assert.equal(f.api.state().facts[0],'Important memory');
  await assert.rejects(f.api.deleteContext({history:true,from:'2026-02-30'}),/valid dates/);
});

test('full context reset keeps connection, personality, interests and people; device wipe removes them',async()=>{
  const f=fixture();f.api.setState({apiKey:'keep-key',masterPrompt:'Keep voice',profile:'Clear profile',people:[{id:'p',name:'Keep person',notes:'A perspective'}],personaChats:[{personId:'p',role:'me',text:'Clear imaginary chat',ts:1}]});
  await f.api.addMessage('me','Clear conversation');await f.api.applyAction({tasks:[{title:'Clear task'}],goals:[{title:'Clear goal'}],memories:[{key:'clear',text:'Clear fact'}]});
  await f.api.deleteContext({all:true});assert.equal(f.api.state().apiKey,'keep-key');assert.equal(f.api.state().masterPrompt,'Keep voice');assert.equal(f.api.state().people.length,1);assert.equal(f.api.state().profile,'');assert.equal(f.api.state().personaChats.length,0);assert.equal(f.api.messages().length,0);assert.equal(f.api.tasks().length,0);assert.equal(f.api.state().memories.length,0);
  await f.api.deleteContext({all:true,wipe:true});assert.equal(f.api.state().apiKey,'');assert.equal(f.api.state().masterPrompt,null);assert.equal(f.api.state().people.length,0);
});

test('an in-flight summary cannot restore history after context deletion',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});for(let i=0;i<30;i++)await f.api.addMessage('me','Delete '+i);
  let finish,started;const requestStarted=new Promise(r=>{started=r;});f.context.fetch=()=>{started();return new Promise(r=>{finish=r;});};
  const pending=f.api.maybeSummarize();await requestStarted;await f.api.deleteContext({all:true});
  finish({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"summary":"Deleted content"}'}]}}]})});await pending;
  assert.equal(f.tables.messages.size,0);assert.equal(f.tables.summaries.size,0);assert.equal(f.api.messages().length,0);
});

test('another tab resetting context prevents sending stale private context',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});f.tables.meta.set('state',{k:'state',revision:1,contextRevision:1});
  let calls=0;f.context.fetch=async()=>{calls++;throw new Error('Should not send');};
  await assert.rejects(f.api.ask('coach','Hi'),/Context changed in another tab/);assert.equal(calls,0);
});

test('backup round trips preserve editable prompts and fictional chats, and reject malformed persona data',async()=>{
  const f=fixture();await f.api.savePersonalization({masterPrompt:'Short custom voice',people:[{id:'p',name:'A Founder',notes:''}],personaChats:[{personId:'p',role:'ai',text:'Fictional advice',ts:1}]});
  const dump=await f.api.backupDump();const backup=f.api.validateBackup(dump);assert.equal(backup.state.masterPrompt,'Short custom voice');assert.equal(backup.state.personaChats.length,1);
  const invalid=structuredClone(dump);invalid.state.personaChats[0].personId='missing';assert.throws(()=>f.api.validateBackup(invalid),/fictional conversation/);
});
test('rename retains the original database and all archived task days',async()=>{
  const f=fixture();f.tables.tasks.set('yesterday',{id:'yesterday',day:'2000-01-01',title:'Old task'});
  await f.api.loadState();assert.equal(f.api.tasks().length,1);assert.equal(f.api.todaysTasks().length,0);assert.equal(f.tables.tasks.size,1);
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
  assert.equal(result.text,'Got you 💅');assert.deepEqual(plain(result.receipts),['Updated memory']);
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
  const f=fixture();f.api.setState({useHackerNews:true,interests:['software','design'],excludedNews:['crypto']});let count=0;
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
  const f=fixture();f.api.setState({useHackerNews:true,apiKey:'test-only',interests:['software'],profile:'PRIVATE PROFILE',facts:['PRIVATE FACT'],goals:[{title:'PRIVATE GOAL'}]});f.api.setMessages([{id:1,role:'me',text:'PRIVATE CHAT',day:'2000-01-01',ts:1}]);let calls=0;
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
  const f=fixture();f.api.setState({useHackerNews:true,apiKey:'test-only',interests:['software']});
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
  await f.api.refreshDay();assert.equal(f.api.tasks().length,1);assert.equal(f.api.todaysTasks().length,0);assert.equal(f.tables.tasks.size,1);
  f.context.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{text:'You showed up today. That counts.'}]}}]})});
  await f.api.closeDay();assert.equal(f.tables.tasks.size,1);assert.equal(f.api.messages().length,1);
});
test('every referenced UI id exists and no automatic morning plan runs at boot',()=>{
  const html=fs.readFileSync('index.html','utf8'), source=fs.readFileSync('app.js','utf8');const dynamic=new Set(['briefBtn','closeDay']);
  for(const match of source.matchAll(/\$\('([^']+)'\)/g)) if(!dynamic.has(match[1])) assert.ok(html.includes(`id="${match[1]}"`),'Missing '+match[1]);
  assert.ok(!source.slice(source.indexOf('async function boot')).includes('getBrief()'));
});

test('morning focus selects only chosen work while retaining the full backlog',async()=>{
  const f=fixture();await f.api.applyAction({tasks:[{title:'Send invoice',deadline:f.api.today()},{title:'Build next feature'},{title:'Wait for approval',blockedBy:'Client approval'}]});
  const [invoice,feature,blocked]=f.api.tasks();
  await f.api.applyAction({today_task_ids:[invoice.id],brief:'Send the promised invoice today.'});
  assert.deepEqual(plain(f.api.todaysTasks().map(t=>t.id)),[invoice.id]);assert.equal(f.api.activeTasks().length,3);
  const before=f.api.actionSnapshot();await assert.rejects(f.api.applyAction({today_task_ids:[blocked.id]}),/blocked/);assert.equal(f.api.actionSnapshot(),before);
  await f.api.applyAction({completed_ids:[invoice.id]});assert.equal(f.api.tasks()[0].completedDay,f.api.today());
  assert.equal(f.api.activeTasks().length,2);assert.ok(f.api.contextBlock('brief').includes(feature.title));
});

test('morning chat naturally requests today and future constraints stay in context',async()=>{
  const f=fixture();assert.equal(f.api.morningRequest('Good morning. What do I absolutely have to do today?'),true);
  assert.equal(f.api.morningRequest('I finished the invoice'),false);
  await f.api.applyAction({tasks:[{title:'Prepare release',deadline:'2099-01-05',notBefore:'2099-01-01'}]});
  assert.equal(f.api.rankedTasks().length,0);assert.ok(f.api.contextBlock('brief').includes('2099-01-05'));
});

test('stable task IDs prevent ambiguous title completion and support reopening',async()=>{
  const f=fixture();f.api.setTasks([{id:'a',day:f.api.today(),title:'Review',done:false},{id:'b',day:f.api.today(),title:'Review',done:false}]);
  await assert.rejects(f.api.applyAction({completed:['Review']}),/Ambiguous/);
  await f.api.applyAction({completed_ids:['b']});assert.equal(f.api.tasks()[0].done,false);assert.ok(f.api.tasks()[1].completedAt);
  await f.api.applyAction({tasks:[{id:'b',done:false,title:'Review design'}]});assert.equal(f.api.tasks()[1].completedAt,undefined);assert.equal(f.api.tasks()[1].title,'Review design');
});

test('cancelled commitments remain in history and do not return to daily focus',async()=>{
  const f=fixture();await f.api.applyAction({tasks:[{title:'Cancelled meeting'}]});const id=f.api.tasks()[0].id;
  await f.api.applyAction({cancel_ids:[id]});assert.equal(f.api.activeTasks().length,0);assert.equal(f.tables.tasks.size,1);
  await assert.rejects(f.api.applyAction({today_task_ids:[id]}),/cancelled/);
});

test('memory correction replaces active knowledge while retaining provenance',async()=>{
  const f=fixture();await f.api.addMessage('me','Sarah is our pilot contact');
  await f.api.applyAction({memories:[{key:'pilot.contact',scope:'Pilot',text:'Pilot contact is Sarah'}]});
  const first=f.api.state().memories[0];assert.equal(first.sourceMessageId,1);
  await f.api.addMessage('me','John replaced Sarah');
  await f.api.applyAction({memories:[{id:first.id,text:'Pilot contact is John'}]});
  assert.deepEqual(plain(f.api.state().facts),['Pilot contact is John']);assert.equal(f.api.state().memories[0].reason,'corrected');
  const current=f.api.state().memories[1];assert.equal(current.key,'pilot.contact');assert.equal(current.sourceMessageId,2);
  await f.api.applyAction({forget_memory_ids:[current.id]});assert.equal(f.api.state().facts.length,0);
  const saved=plain(f.api.state());f.tables.meta.set('state',{k:'state',...saved});await f.api.loadState();assert.equal(f.api.state().facts.length,0);
});

test('durable memory no longer silently evicts the oldest fact at sixty entries',async()=>{
  const f=fixture();for(let i=0;i<70;i++)await f.api.applyAction({memories:[{key:'fact'+i,text:'Useful fact '+i}]});
  assert.equal(f.api.state().facts.length,70);assert.equal(f.api.state().facts[0],'Useful fact 0');
});

test('milestone completion determines goal progress instead of arbitrary percentages',async()=>{
  const f=fixture();await f.api.applyAction({goals:[{title:'Launch',progress:99,milestones:[{id:'design',title:'Design agreed',done:true},{id:'pilot',title:'Pilot completed',done:false}]}]});
  assert.equal(f.api.state().goals[0].progress,50);
  await f.api.applyAction({goals:[{id:f.api.state().goals[0].id,progress:100}]});assert.equal(f.api.state().goals[0].progress,50);
});

test('pending messages remain in context before the first summary and after summary failure',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});
  for(let i=0;i<30;i++)await f.api.addMessage(i%2?'ai':'me','Decision detail '+i);
  let body;f.context.fetch=async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{text:'Here'}]}}]})};};
  await f.api.ask('coach','Hello',{append:false});assert.equal(body.contents.length,30);assert.ok(body.contents[0].parts[0].text.includes('detail 0'));
  assert.equal(await f.api.maybeSummarize(),false);assert.match(f.node('memoryHealth').textContent,/valid episode summary/);
  assert.equal([...f.tables.messages.values()].filter(m=>m.s===1).length,0);
  await f.api.ask('coach','Hello',{append:false});assert.equal(body.contents.length,30);
});

test('episode creation and coverage are atomic when storage fails',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});for(let i=0;i<26;i++)await f.api.addMessage('me','Decision '+i);
  f.context.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{text:'{"summary":"A sourced decision."}'}]}}]})});
  f.database.failNextWrite=true;assert.equal(await f.api.maybeSummarize(),false);assert.equal(f.tables.summaries.size,0);
  assert.equal([...f.tables.messages.values()].filter(m=>m.s===1).length,0);
  assert.equal(await f.api.maybeSummarize(),true);assert.equal(f.tables.summaries.size,1);
});

test('search_memory retrieves neighboring exchanges and searches inside date bounds',async()=>{
  const f=fixture();f.api.setMessages([{id:1,role:'me',day:'2025-01-01',ts:1,text:'We chose SQLite for offline support',s:1},{id:2,role:'ai',day:'2025-01-01',ts:2,text:'That keeps the pilot simple',s:1},{id:3,role:'me',day:'2026-01-01',ts:3,text:'SQLite reminder',s:1}]);
  const result=await f.api.searchMemory({query:'SQLite',endDay:'2025-12-31'});
  assert.ok(result.exchanges.includes('offline support'));assert.ok(result.exchanges.includes('pilot simple'));
  await assert.rejects(f.api.searchMemory({query:'SQLite',startDay:'2026-02-30'}),/Invalid search date/);
});

test('automatic snapshots omit credentials and retain lifecycle and memory records',async()=>{
  const f=fixture();f.api.setState({apiKey:'private-key'});await f.api.addMessage('me','Private conversation');
  await f.api.applyAction({tasks:[{title:'Invoice',deadline:f.api.today()}],memories:[{key:'contact',text:'Contact is Sarah'}]});
  await f.api.automaticBackup();const snapshot=f.tables.backups.get(f.api.today());
  assert.equal(snapshot.dump.state.apiKey,undefined);assert.equal(snapshot.dump.messages[0].text,'Private conversation');
  assert.equal(snapshot.dump.tasks[0].deadline,f.api.today());assert.equal(snapshot.dump.state.memories.length,1);
  const restored=f.api.validateBackup(snapshot.dump);assert.equal(restored.state.apiKey,'private-key');
});

test('malformed dates, priorities, and memory backups are rejected before replacement',()=>{
  const f=fixture();assert.throws(()=>f.api.validateAction({tasks:[{title:'Bad',deadline:'2026-02-30'}]}),/Invalid deadline/);
  assert.throws(()=>f.api.validateAction({tasks:[{title:'Bad',priority:'panic'}]}),/Invalid priority/);
  assert.throws(()=>f.api.validateBackup({state:{memories:[{id:'m',key:'k',scope:'p',text:'x',retiredAt:'bad'}]},messages:[],tasks:[],summaries:[]}),/timestamp/);
});

test('plain JSON in a model reply cannot bypass native tool validation',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});f.node('chatInput').value='Explain this example';
  f.context.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{text:'{"tasks":[{"title":"Unrequested task"}]}'}]}}]})});
  await f.api.sendChat();assert.equal(f.api.tasks().length,0);assert.ok(f.api.messages().at(-1).text.includes('Unrequested task'));
});

test('a stale tab cannot overwrite newer task and memory state',async()=>{
  const f=fixture();await f.api.applyAction({tasks:[{title:'Keep this commitment'}]});
  const before=f.api.actionSnapshot();f.tables.meta.set('state',{...f.tables.meta.get('state'),revision:20,facts:['Newer fact from another tab']});
  await assert.rejects(f.api.applyAction({memories:[{key:'stale',text:'Old-tab update'}]}),/Another tab/);
  assert.equal(f.api.actionSnapshot(),before);assert.equal(f.tables.meta.get('state').revision,20);assert.equal(f.tables.tasks.size,1);
});

test('concurrent memory maintenance runs create a single episode',async()=>{
  const f=fixture();f.api.setState({apiKey:'test-only'});for(let i=0;i<26;i++)await f.api.addMessage('me','A decision '+i);
  let calls=0;f.context.fetch=async()=>{calls++;return {ok:true,json:async()=>({candidates:[{content:{role:'model',parts:[{text:'{"summary":"One episode."}'}]}}]})};};
  await Promise.all([f.api.maybeSummarize(),f.api.maybeSummarize()]);assert.equal(calls,1);assert.equal(f.tables.summaries.size,1);
});
