const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function workerFixture(){
  const events={},entries=new Map(),removed=[],requests=[],network=[];
  const base='https://example.com/moeware/sw.js';
  const key=value=>new URL(typeof value==='string'?value:value.url,base).href;
  const cache={
    async addAll(values){requests.push(...values);for(const value of values)entries.set(key(value),new Response('Installed '+key(value)));},
    async match(value){return entries.get(key(value))?.clone();}
  };
  const context={URL,Request,Response,self:{location:new URL(base),clients:{claim:async()=>{}},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:()=>{}},caches:{open:async()=>cache,keys:async()=>['coach-v7','wrinkle-coach-v8','unrelated-app'],delete:async name=>removed.push(name)},fetch:async request=>{network.push(request.url);return new Response('Next release');}};
  vm.runInNewContext(fs.readFileSync('sw.js','utf8'),context);
  const install=async()=>{let work;events.install({waitUntil:p=>work=p});await work;};
  const read=async(path,mode='cors')=>{let response;events.fetch({request:{url:key(path),method:'GET',mode},respondWith:p=>response=p});return response;};
  return {events,entries,requests,network,removed,install,read};
}

test('installed HTML and scripts use one release even when the server has newer files',async()=>{
  const f=workerFixture();await f.install();
  assert.match(await (await f.read('./','navigate')).text(),/Installed.*index.html/);
  assert.match(await (await f.read('app.js?v=8')).text(),/Installed.*app.js\?v=8/);
  assert.equal(f.network.length,0);
  assert.ok(f.requests.every(r=>r.cache==='reload'));
});

test('every local file referenced by the installed page is precached, including recovery controls',async()=>{
  const f=workerFixture();await f.install();const html=fs.readFileSync('index.html','utf8');
  for(const [,path] of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|png|webmanifest)\?v=8)"/g))assert.ok(f.requests.some(r=>r.url.endsWith('/'+path)),path);
  assert.ok(f.requests.some(r=>r.url.endsWith('/startup.js?v=8')));
});

test('worker upgrades remove only old app-shell caches; external calls bypass the cache',async()=>{
  const f=workerFixture();let work;f.events.activate({waitUntil:p=>work=p});await work;
  assert.deepEqual(f.removed,['coach-v7']);assert.equal(await f.read('https://example.org/feed'),undefined);
  await f.install();assert.equal(await (await f.read('future.js?v=9')).text(),'Next release');
  assert.equal(f.entries.has('https://example.com/moeware/future.js?v=9'),false);
});

test('reload and service-worker updates work without app.js or IndexedDB initializing',async()=>{
  const nodes=new Map(),events={},listeners={},posted=[];let reloads=0;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',addEventListener:(name,fn)=>listeners[id+':'+name]=fn});return nodes.get(id);};
  const registration={waiting:{postMessage:message=>posted.push(message)},addEventListener(){},update:async()=>{}};
  const context={document:{getElementById:node},window:{addEventListener:(name,fn)=>events[name]=fn},navigator:{serviceWorker:{addEventListener:(name,fn)=>events[name]=fn,register:async(url,options)=>{assert.equal(options.updateViaCache,'none');return registration;}}},location:{reload:()=>reloads++},setTimeout:()=>1,clearTimeout(){}};
  vm.runInNewContext(fs.readFileSync('startup.js','utf8'),context);await new Promise(setImmediate);
  assert.equal(node('updateBanner').hidden,false);listeners['installUpdate:click']();assert.equal(posted[0].type,'SKIP_WAITING');events.controllerchange();assert.equal(reloads,1);
  context.window.WrinkleStartup.status('Close other tabs');assert.equal(node('startupMessage').textContent,'Close other tabs');assert.equal(node('startupBanner').hidden,false);
  context.window.WrinkleStartup.ready();assert.equal(node('startupBanner').hidden,true);
});
