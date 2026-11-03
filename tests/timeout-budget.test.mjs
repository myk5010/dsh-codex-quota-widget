import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {QuotaMonitor} from '../monitor.js';import {DebugRecorder} from '../debug.js';
const grant={access:'FAKE_ACCESS',accountId:'FAKE_ACCOUNT'};
const usage={rate_limit:{primary_window:{used_percent:1,limit_window_seconds:604800,reset_at:1800000000}}};
test('a 15-second response succeeds under the new default 20-second budget',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});let calls=0;const d=new DebugRecorder();d.enable();
 const m=new QuotaMonitor({readGrant:async()=>grant,diagnostics:d,fetchImpl:async()=>{calls++;return new Promise(resolve=>setTimeout(()=>resolve(Response.json(usage)),15000));}});
 try{assert.equal(m.timeoutMs,20000);const pending=m.getStatus();await Promise.resolve();assert.equal(calls,1);t.mock.timers.tick(15000);const result=await pending;assert.equal(result.status,'ok');assert.equal(result.windows[0].remainingPercent,99);assert.equal(d.read().entries.some(e=>e.event==='deadline_exceeded'),false);assert.ok(d.read().entries.some(e=>e.event==='query_succeeded'&&e.durationMs===15000&&e.timeoutMs===20000));}finally{m.dispose();}
});
test('the default request is not aborted before 20 seconds and is aborted at 20 seconds',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});let signal;const d=new DebugRecorder();d.enable();const m=new QuotaMonitor({readGrant:async()=>grant,diagnostics:d,fetchImpl:async(u,o)=>{signal=o.signal;return new Promise((r,j)=>signal.addEventListener('abort',()=>j(new DOMException('test abort','AbortError'))));}});
 try{const pending=m.getStatus();await Promise.resolve();t.mock.timers.tick(19999);assert.equal(signal.aborted,false);t.mock.timers.tick(1);assert.equal(signal.aborted,true);const result=await pending;assert.equal(result.errorCode,'network_error');assert.ok(d.read().entries.some(e=>e.event==='deadline_exceeded'&&e.timeoutMs===20000&&e.elapsedMs===20000));}finally{m.dispose();}
});
test('browser status polling uses 30 seconds and keeps five-second cadence',async()=>{
 let definition;vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:d=>definition=d}},AbortController});const{createPoller}=definition.factory(()=>({createElement:()=>null})).testing;
 let requestMs,intervalMs,finish,signal,cleared=false;const timers={setTimeout(fn,ms){requestMs=ms;return 1;},clearTimeout(){cleared=true;},setInterval(fn,ms){intervalMs=ms;return 2;},clearInterval(){}};
 const p=createPoller({timers,call:s=>{signal=s;return new Promise(resolve=>finish=resolve);},onChange:()=>{}});p.start();assert.equal(requestMs,30000);assert.equal(intervalMs,5000);assert.equal(signal.aborted,false);finish({ok:true,value:{status:'ok',windows:[]}});await new Promise(r=>setImmediate(r));assert.equal(signal.aborted,false);assert.equal(cleared,true);p.stop();
});
