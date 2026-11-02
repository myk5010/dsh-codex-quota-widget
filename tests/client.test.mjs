import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
function load(){let definition;const React={createElement:()=>null};const ctx={window:{__ModuleLoader__:{load:d=>definition=d}},AbortController,console};vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),ctx);assert.equal(definition.id,'dsh-codex-quota-widget');const module=definition.factory(id=>{assert.equal(id,'react');return React;});return module;}
function loadSource(){const exports={};vm.runInNewContext(fs.readFileSync(new URL('../source/client.cjs',import.meta.url),'utf8'),{exports,require:id=>{assert.equal(id,'react');return{createElement:()=>null};},AbortController,setTimeout,clearTimeout});return exports;}
const tick=()=>new Promise(r=>setImmediate(r));
function timers(){let interval,ms;return{setInterval(fn,n){interval=fn;ms=n;return 1;},clearInterval(){interval=null;},setTimeout(){return 2;},clearTimeout(){},fire:()=>interval?.(),get ms(){return ms;},get running(){return!!interval;}};}

test('bundle factory uses platform React and has no host secrets/credential dependencies',()=>{const m=load();assert.deepEqual(Array.from(m.inject),['slots','connection']);assert.equal(typeof m.apply,'function');assert.equal(fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8').includes('readRecord'),false);});
test('friendly labels for real 7d quota and unknown windows',()=>{const t=load().testing;assert.equal(t.windowLabel({group:'codex',windowSeconds:604800}),'7 天');assert.equal(t.windowLabel({group:'codex',windowSeconds:18000}),'5 小时');assert.equal(t.percent(null),'未知');assert.match(t.brief({status:'ok',windows:[{group:'codex',windowSeconds:604800,remainingPercent:99}]}),/99%/);assert.doesNotMatch(t.brief({status:'error',windows:[{group:'codex',remainingPercent:99}]}),/过期/);});
test('badge replaces Codex and window length with actual reset countdown',()=>{const t=load().testing,now=1800000000000;const data={status:'ok',windows:[{group:'codex',windowSeconds:604800,remainingPercent:57,resetAt:now+(5*24+10)*3600000}]};assert.equal(t.brief(data,now),'5天10小时 57%');assert.equal(t.windowLabel(data.windows[0]),'7 天');});
test('countdown formats day/hour and short window boundaries',()=>{const t=load().testing,now=1800000000000;for(const[ms,text]of[[86400000,'1天0小时'],[3*86400000,'3天0小时'],[23*3600000+59*60000,'23小时59分钟'],[3600000,'1小时0分钟'],[125*60000,'2小时5分钟'],[59*60000+59999,'59分钟'],[60000,'1分钟'],[59999,'不足1分钟'],[1,'不足1分钟']])assert.equal(t.resetCountdown(now+ms,now),text);});
test('missing reset timestamps do not fabricate seven days',()=>{const t=load().testing,now=1800000000000;for(const resetAt of[undefined,null,0,-1,NaN,Infinity,'1800000000000'])assert.equal(t.resetCountdown(resetAt,now),'重置时间未知');assert.equal(t.brief({status:'ok',windows:[{group:'codex',windowSeconds:604800,remainingPercent:57}]},now),'重置时间未知 57%');});
test('elapsed reset time requests fresh data without pretending quota recovered',()=>{const t=load().testing,now=1800000000000;assert.equal(t.resetCountdown(now,now),'待刷新');assert.equal(t.resetCountdown(now-1,now),'待刷新');assert.equal(t.brief({status:'ok',windows:[{group:'codex',resetAt:now-1,remainingPercent:57}]},now),'待刷新 57%');});
test('same cached quota counts down using current clock without another upstream value',()=>{const t=load().testing,now=1800000000000,data={status:'ok',windows:[{group:'codex',remainingPercent:57,resetAt:now+(5*24+10)*3600000}]};assert.equal(t.brief(data,now),'5天10小时 57%');assert.equal(t.brief(data,now+3600000),'5天9小时 57%');});
test('multiple quota windows preserve ordering without stale text',()=>{const t=load().testing,now=1800000000000,data={status:'ok',windows:[{group:'codex',remainingPercent:57,resetAt:now+(5*24+10)*3600000},{group:'codex',remainingPercent:80,resetAt:now+90*60000}]};assert.equal(t.brief(data,now),'5天10小时 57% · 1小时30分钟 80%');assert.equal(t.brief({...data,stale:true},now),'5天10小时 57% · 1小时30分钟 80%');assert.equal(t.brief({...data,status:'error'},now),'5天10小时 57% · 1小时30分钟 80%');});
test('all query failures retain the normal compact quota text without error suffixes',()=>{const t=load().testing,now=1800000000000,windows=[{group:'codex',remainingPercent:57,resetAt:now+(5*24+10)*3600000}];for(const errorCode of ['network_error','connection_error','access_denied','rate_limited','schema_changed'])assert.equal(t.brief({status:'error',errorCode,stale:true,windows},now),'5天10小时 57%');});
test('query failure without quota shows only the indicator and never fake old account data',()=>{const t=load().testing;for(const errorCode of ['login_expired','not_logged_in','network_error','connection_error'])assert.equal(t.brief({status:'error',errorCode,windows:[]}), '');assert.match(t.CSS,/data-state=error\] \{ background:#dc2626;/);});
test('polls immediately then every 5000ms and disposes timer',async()=>{const t=load().testing;const timer=timers();let calls=0,updates=0;const p=t.createPoller({timers:timer,call:async()=>{calls++;return{ok:true,value:{status:'ok',windows:[]}};},onChange:()=>updates++});p.start();await tick();assert.equal(calls,1);assert.equal(timer.ms,5000);timer.fire();await tick();assert.equal(calls,2);assert.equal(updates,2);p.stop();assert.equal(timer.running,false);});
test('no overlapping poll while request is pending; unmount ignores late result',async()=>{const t=load().testing;const timer=timers();let resolve,calls=0,updates=0;const p=t.createPoller({timers:timer,call:()=>{calls++;return new Promise(r=>resolve=r);},onChange:()=>updates++});p.start();timer.fire();assert.equal(calls,1);p.stop();resolve({ok:true,value:{windows:[]}});await tick();assert.equal(updates,0);});
test('background tabs pause polling, visibility resumes, listeners disposed',async()=>{const t=load().testing;const timer=timers();let listener,calls=0;const doc={hidden:true,addEventListener(k,l){listener=l;},removeEventListener(){listener=null;}};const p=t.createPoller({timers:timer,documentRef:doc,call:async()=>{calls++;return{ok:true,value:{windows:[]}};},onChange:()=>{}});p.start();await tick();assert.equal(calls,0);doc.hidden=false;listener();await tick();assert.equal(calls,1);doc.hidden=true;timer.fire();await tick();assert.equal(calls,1);p.stop();assert.equal(listener,null);});
test('RPC failure preserves last data and marks connection error',async()=>{const t=load().testing;const timer=timers();let calls=0,last;const p=t.createPoller({timers:timer,call:async()=>++calls===1?{ok:true,value:{status:'ok',windows:[{remainingPercent:90}]}}:{ok:false,error:{message:'PRIVATE_ERROR'}},onChange:x=>last=x});p.start();await tick();timer.fire();await tick();assert.equal(last.errorCode,'connection_error');assert.equal(last.windows[0].remainingPercent,90);assert.equal(last.stale,true);assert.equal(JSON.stringify(last).includes('PRIVATE'),false);p.stop();});

const plain=value=>JSON.parse(JSON.stringify(value));
function debugInfo(now,extra={}){return{enabled:true,startedAt:now,expiresAt:now+1800000,generation:1,count:1,lastSeq:1,maxEntries:300,ttlMs:1800000,timeoutMs:10000,pollIntervalMs:5000,entries:[{source:'host',seq:1,timestampMs:now,event:'debug_enabled'}],...extra};}
test('client journal is opt-in, stops on disable/TTL and retains recorded entries',()=>{
  const t=loadSource().testing;let now=1000;const j=t.createClientJournal({now:()=>now});
  assert.equal(j.begin(),null);j.record(null,{ok:true});assert.equal(j.snapshot().length,0);
  j.sync(debugInfo(now));const token=j.begin();now+=25;j.record(token,{timestampMs:now,durationMs:25,ok:true,aborted:false});
  assert.deepEqual(plain(j.snapshot()),[{source:'client',event:'status_rpc',requestId:'r1',timeoutMs:15000,timestampMs:1025,durationMs:25,ok:true,aborted:false}]);
  j.sync(debugInfo(1000,{enabled:false}));assert.equal(j.begin(),null);j.record(token,{ok:false});assert.equal(j.snapshot().length,1);
  j.sync(debugInfo(1000));now=1801000;assert.equal(j.info().enabled,false);assert.equal(j.begin(),null);j.record(token,{ok:false});assert.equal(j.snapshot().length,1);
});
test('client journal bounds to 300, clears on generation change and rejects late pre-clear RPCs',()=>{
  const t=loadSource().testing,now=1000,j=t.createClientJournal({now:()=>now});j.sync(debugInfo(now));
  for(let i=0;i<301;i++)j.record(j.begin(),{timestampMs:now,durationMs:i,ok:true,aborted:false});
  assert.equal(j.snapshot().length,300);assert.equal(j.snapshot()[0].requestId,'r2');assert.equal(j.snapshot().at(-1).requestId,'r301');
  const old=j.begin();j.clear();j.record(old,{ok:true});assert.equal(j.snapshot().length,0);
  j.record(j.begin(),{ok:true});assert.equal(j.snapshot().length,1);j.sync(debugInfo(now,{generation:2}));assert.equal(j.snapshot().length,0);assert.equal(j.begin().requestId,'r1');
});
test('debug metadata expires exactly at TTL and defaults to off for missing/invalid deadline',()=>{
  const t=loadSource().testing,now=1000;
  assert.equal(t.safeDebugInfo(debugInfo(now),now+1799999).enabled,true);
  for(const expiresAt of[now,null,undefined,NaN,Infinity,'9999999'])assert.equal(t.safeDebugInfo(debugInfo(now,{expiresAt}),now).enabled,false);
  assert.equal(t.safeDebugInfo(null,now).enabled,false);
});
test('journals and export reject unknown fields, raw errors, request payloads and quota/account data',()=>{
  const t=loadSource().testing,now=1000,privateFields={message:'PRIVATE_MESSAGE',url:'https://private.invalid',headers:{Authorization:'PRIVATE_TOKEN'},body:'PRIVATE_BODY',account:'PRIVATE_ACCOUNT',sessionId:'PRIVATE_SESSION',rpcId:'PRIVATE_RPC',payload:{secret:'PRIVATE_PAYLOAD'}};
  const host={source:'host',event:'query_failed',seq:2,timestampMs:now,requestId:'q2',stage:'upstream_fetch',durationMs:10000,httpStatus:503,errorCode:'network_error',errorName:'TypeError',causeName:'ConnectTimeoutError',networkCode:'UND_ERR_CONNECT_TIMEOUT',timedOut:true,retryMs:5000,...privateFields};
  const j=t.createClientJournal({now:()=>now});j.sync(debugInfo(now));j.record(j.begin(),{timestampMs:now,durationMs:1,ok:false,aborted:true,...privateFields});
  const result=t.buildDebugExport({...debugInfo(now),entries:[host,{source:'host',event:'PRIVATE_EVENT',message:'PRIVATE'}],...privateFields,windows:[{remainingPercent:93}],credits:{balance:100}},[...j.snapshot(),{source:'client',event:'PRIVATE_EVENT',requestId:'r8'},...Array(301).fill({...j.snapshot()[0],...privateFields})],now);
  assert.equal(result.schemaVersion,1);assert.equal(result.host.entries.length,1);assert.equal(result.client.entries.length,300);assert.equal(result.host.entries[0].httpStatus,503);assert.equal(result.config.timeoutMs,10000);assert.equal(result.config.clientRpcTimeoutMs,15000);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|private|windows|credits|Authorization|remainingPercent/);
  assert.equal(t.safeHostEntry({...host,event:'query_failed',stage:'PRIVATE',errorCode:'PRIVATE',errorName:'PRIVATE',causeName:'PRIVATE',networkCode:'PRIVATE',requestId:'session-123'}).stage,undefined);
  assert.equal(t.safeHostEntry({...host,httpStatus:999}).httpStatus,undefined);
  assert.equal(t.safeClientEntry({...j.snapshot()[0],requestId:['r1']}),null);
});
test('status RPC wrapper records safe success/failure, duration and abort without changing return/throw',async()=>{
  const t=loadSource().testing;let now=1000,mode='ok';const seen=[];
  const rpc={async call(...args){seen.push(args);now+=12;if(mode==='throw')throw new Error('PRIVATE_EXCEPTION');return mode==='failure'?{ok:false,error:{message:'PRIVATE_RESPONSE'}}:{ok:true,value:{windows:[],debug:debugInfo(1000)}};}};
  const {call,callDebug,clientJournal:j}=t.createClientRPC({rpc,now:()=>now});const controller=new AbortController();
  await call(controller.signal);assert.equal(j.snapshot().length,0,'first disabled request never recorded');
  await call(controller.signal);assert.equal(j.snapshot()[0].durationMs,12);assert.equal(j.snapshot()[0].ok,true);
  mode='failure';assert.equal((await call(controller.signal)).ok,false);assert.equal(j.snapshot().at(-1).ok,false);
  mode='throw';controller.abort();await assert.rejects(call(controller.signal),/PRIVATE_EXCEPTION/);assert.equal(j.snapshot().at(-1).aborted,true);
  assert.doesNotMatch(JSON.stringify(j.snapshot()),/PRIVATE/);assert.equal(seen[0][0],'/api');assert.equal(seen[0][1],'codex-quota/status');assert.equal(seen[0][3],controller.signal);
  await assert.rejects(callDebug('unknown'),/debug_operation_failed/);
});
test('debug controls have a cleared 15s deadline without logging raw errors',async()=>{const t=loadSource().testing;let fire,cleared=false;const timers={setTimeout(fn,ms){assert.equal(ms,15000);fire=fn;return 1;},clearTimeout(){cleared=true;}};const wrapper=t.createClientRPC({timers,rpc:{call(base,route,payload,signal){return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('PRIVATE_CONTROL_ERROR'))));}}});const pending=wrapper.callDebug('read');fire();await assert.rejects(pending,/PRIVATE_CONTROL_ERROR/);assert.equal(cleared,true);assert.equal(wrapper.clientJournal.snapshot().length,0);});
test('debug controls sync generation, clear client logs, and stale status cannot undo disable or clear',async()=>{
  const t=loadSource().testing;let now=1000,meta=debugInfo(now),finishStatus;
  const rpc={async call(base,route,args){assert.equal(base,'/api');if(route.endsWith('/status'))return new Promise(resolve=>finishStatus=resolve);if(args.action==='disable')meta={...meta,enabled:false};if(args.action==='clear')meta={...meta,count:0,entries:[]};return{ok:true,value:meta};}};
  const {call,callDebug,clientJournal:j}=t.createClientRPC({rpc,now:()=>now});await callDebug('enable');j.record(j.begin(),{ok:true});
  let pending=call();await callDebug('clear');finishStatus({ok:true,value:{windows:[],debug:debugInfo(now)}});await pending;assert.equal(j.snapshot().length,0);assert.equal(j.info().count,0);
  pending=call();await callDebug('disable');finishStatus({ok:true,value:{windows:[],debug:debugInfo(now)}});await pending;assert.equal(j.info().enabled,false);assert.equal(j.snapshot().length,0);
});
