import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const reactUmd=process.env.REACT_UMD || path.join(path.dirname(require.resolve('react/package.json')),'umd','react.development.js');
const reactDomUmd=process.env.REACT_DOM_UMD || path.join(path.dirname(require.resolve('react-dom/package.json')),'umd','react-dom.development.js');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
async function fixture(page) {
  await page.setContent('<!doctype html><html lang="zh-CN"><head></head><body><div>Quota interaction fixture (no real account)</div></body></html>');
  await page.addScriptTag({path:reactUmd});
  await page.addScriptTag({path:reactDomUmd});
  await page.evaluate(()=>{window.__ModuleLoader__={load:d=>window.quotaPlugin=d.factory(n=>{if(n!=='react')throw Error('unexpected dependency');return window.React;})};});
  await page.addScriptTag({path:new URL('../lib/client.js',import.meta.url).pathname});
  await page.evaluate(()=>{
    window.rpcCalls=0;window.disposers=[];window.fixtureResetAt=Date.now()+(5*24+10)*3600000+30*60000;
    window.fixtureMode='ok';window.fixtureLastGood=null;window.debugActions=[];window.fixtureDebugFail=false;
    window.fixtureDebug={enabled:false,startedAt:null,expiresAt:null,generation:0,count:0,lastSeq:0,maxEntries:300,ttlMs:1800000,timeoutMs:20000,pollIntervalMs:5000,entries:[]};
    const event=(name,fields={})=>{const d=window.fixtureDebug;d.entries.push({source:'host',seq:++d.lastSeq,timestampMs:Date.now(),event:name,...fields});d.entries=d.entries.slice(-300);d.count=d.entries.length;};
    const metadata=(all=false)=>{const d=window.fixtureDebug;if(d.enabled&&Date.now()>=d.expiresAt){d.enabled=false;event('debug_expired');}return{...d,entries:d.entries.slice(all?-300:-30)};};
    const call=async(base,route,args)=>{
      if(base!=='/api')throw Error('fixture route mismatch');
      if(route==='codex-quota/debug'){
        window.debugActions.push(args.action);
        if(window.fixtureDebugFail)return{ok:false,error:{message:'PRIVATE_DEBUG_FAILURE'}};
        const d=window.fixtureDebug;
        if(args.action==='enable'&&!d.enabled){d.enabled=true;d.generation++;d.startedAt=Date.now();d.expiresAt=d.startedAt+(window.fixtureDebugTtlMs||1800000);d.entries=[];d.lastSeq=0;event('debug_enabled');}
        if(args.action==='disable'&&d.enabled){event('debug_disabled');d.enabled=false;}
        if(args.action==='clear'){d.entries=[];d.count=0;}
        return{ok:true,value:metadata(args.action==='read')};
      }
      if(route!=='codex-quota/status')throw Error('fixture route mismatch');
      window.rpcCalls++;
      if(window.fixtureMode==='rpc_error')return{ok:false,error:{message:'mock request failure'}};
      metadata();if(window.fixtureDebug.enabled)event('rpc_completed',{stage:'rpc',durationMs:8,httpStatus:200,message:'PRIVATE_HOST_MESSAGE',headers:{Authorization:'PRIVATE_TOKEN'}});
      const debug=metadata();
      if(window.fixtureMode==='host_error')return{ok:true,value:{...window.fixtureLastGood,debug,status:'error',errorCode:'network_error',stale:true}};
      if(window.fixtureMode==='no_data')return{ok:true,value:{...window.fixtureLastGood,debug,status:'error',errorCode:'login_expired',windows:[],updatedAt:null,stale:false}};
      const value={status:'ok',errorCode:null,stale:false,updatedAt:Date.now(),nextFetchAt:Date.now()+5000,windows:[{id:'codex:primary_window',group:'codex',windowSeconds:604800,remainingPercent:100-window.rpcCalls,resetAt:window.fixtureResetAt}],limitReached:false,credits:null,debug,account:'PRIVATE_ACCOUNT',token:'PRIVATE_QUOTA_TOKEN'};
      window.fixtureLastGood=value;return{ok:true,value};
    };
    window.quotaPlugin.apply({connection:{rpc:{call}},effect(fn){window.disposers.push(fn());},slots:{inject(n,fn){window.disposers.push(fn());},register(def,Comp){const root=document.createElement('div');document.body.append(root);const r=ReactDOM.createRoot(root);r.render(React.createElement(Comp,def.inject()));return()=>{r.unmount();root.remove();};}}});
  });
  await page.getByTestId('codex-quota-badge').waitFor();
  await page.waitForFunction(()=>document.querySelector('.dsh-codex-quota-toggle')?.textContent.includes('99%'));
}
try {
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await fixture(page);
  const badge=page.getByTestId('codex-quota-badge'), toggle=page.locator('.dsh-codex-quota-toggle'), panel=page.locator('.dsh-codex-quota-panel');
  assert.equal(await panel.count(),0);
  assert.equal(await toggle.innerText(),'5天10小时 99%');
  assert.equal(await badge.evaluate(el=>innerHeight-el.getBoundingClientRect().bottom),96);
  await toggle.hover();await panel.waitFor({state:'visible'});assert.match(await panel.innerText(),/剩余 99%/);assert.match(await panel.innerText(),/7 天/);assert.match(await panel.innerText(),/重置：/);
  const t=await toggle.boundingBox(),p=await panel.boundingBox();
  await page.mouse.move(t.x+t.width/2,(t.y+p.y+p.height)/2);assert.equal(await panel.isVisible(),true,'hover bridge keeps the gap open');
  await panel.hover();assert.equal(await panel.isVisible(),true,'moving inside panel must not close it');
  const out=process.env.ARTIFACT_DIR || fileURLToPath(new URL('../test-results/',import.meta.url));fs.mkdirSync(out,{recursive:true});await toggle.screenshot({path:path.join(out,'quota-countdown-badge.png')});await panel.screenshot({path:path.join(out,'quota-hover-light.png')});
  const closeStart=Date.now();await page.mouse.move(20,20);
  await page.waitForFunction(()=>!document.querySelector('.dsh-codex-quota-panel'),{},{polling:'raf',timeout:500});
  const mouseCloseMs=Date.now()-closeStart;assert.ok(mouseCloseMs<250,'no delayed closing timer');
  await toggle.hover();await toggle.click();assert.equal(await panel.isVisible(),true,'desktop click must not invert hover state');
  await page.waitForFunction(()=>window.rpcCalls>=2,{},{timeout:8000});assert.match(await badge.innerText(),/98%/);
  await panel.hover();await page.evaluate(()=>document.body.setAttribute('data-ds-dark-theme',''));await panel.screenshot({path:path.join(out,'quota-hover-dark.png')});
  await page.mouse.move(20,20);await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('Tab');
  assert.equal(await toggle.evaluate(el=>el===document.activeElement),true);assert.equal(await panel.isVisible(),true,'keyboard focus opens details');
  await page.keyboard.press('Escape');assert.equal(await panel.count(),0);
  await page.keyboard.press('Enter');assert.equal(await panel.isVisible(),true);await page.keyboard.press('Escape');
  await page.setViewportSize({width:360,height:740});assert.equal(await badge.evaluate(el=>innerHeight-el.getBoundingClientRect().bottom),88);
  await page.evaluate(()=>{window.confirmClicks=0;const modal=document.createElement('div');modal.id='confirmation-fixture';modal.setAttribute('aria-modal','true');modal.style.cssText='position:fixed;right:8px;bottom:8px';const button=document.createElement('button');button.textContent='确认';button.id='fixture-confirm';button.style.cssText='width:120px;height:36px';button.onclick=()=>{window.confirmClicks++;modal.remove();};modal.append(button);document.body.append(modal);});
  await badge.waitFor({state:'hidden'});await page.locator('#fixture-confirm').click();await badge.waitFor({state:'visible'});assert.equal(await page.evaluate(()=>window.confirmClicks),1);
  const count=await page.evaluate(()=>window.rpcCalls);await page.evaluate(()=>{for(const d of window.disposers.reverse())d?.();});assert.equal(await badge.count(),0);
  await page.waitForTimeout(5200);assert.equal(await page.evaluate(()=>window.rpcCalls),count);assert.equal(errors.length,0);await context.close();

  const touchContext=await browser.newContext({viewport:{width:360,height:740},isMobile:true,hasTouch:true});
  const touch=await touchContext.newPage();await fixture(touch);
  const touchToggle=touch.locator('.dsh-codex-quota-toggle'),touchPanel=touch.locator('.dsh-codex-quota-panel');
  assert.equal(await touchPanel.count(),0);await touchToggle.tap();assert.equal(await touchPanel.isVisible(),true);
  await touchToggle.tap();assert.equal(await touchPanel.count(),0);
  await touchToggle.tap();await touch.locator('.dsh-codex-quota-close').tap();assert.equal(await touchPanel.count(),0);
  await touchContext.close();

  const errorContext=await browser.newContext({viewport:{width:1280,height:800}});
  const errorPage=await errorContext.newPage();await errorPage.clock.install();await fixture(errorPage);
  const errorToggle=errorPage.locator('.dsh-codex-quota-toggle'),dot=errorPage.locator('.dsh-codex-quota-dot');
  const goodText=await errorToggle.innerText();assert.equal(await dot.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(22, 163, 74)');
  for(const mode of ['rpc_error','host_error']){
    await errorPage.evaluate(mode=>window.fixtureMode=mode,mode);await errorPage.clock.runFor(5000);
    await errorPage.waitForFunction(()=>document.querySelector('.dsh-codex-quota-dot')?.dataset.state==='error');
    assert.equal(await errorToggle.innerText(),goodText);assert.doesNotMatch(await errorToggle.innerText(),/过期|错误|中断|异常/);
    assert.equal(await dot.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(220, 38, 38)');
    await errorToggle.hover();assert.doesNotMatch(await errorPage.locator('.dsh-codex-quota-panel').innerText(),/过期/);
  }
  await errorToggle.screenshot({path:path.join(out,'quota-error-red-dot.png')});
  await errorPage.evaluate(()=>window.fixtureMode='no_data');await errorPage.clock.runFor(5000);
  await errorPage.waitForFunction(()=>document.querySelector('.dsh-codex-quota-toggle')?.textContent==='');
  assert.equal(await dot.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(220, 38, 38)');
  await errorPage.evaluate(()=>window.fixtureMode='ok');await errorPage.clock.runFor(5000);
  await errorPage.waitForFunction(()=>document.querySelector('.dsh-codex-quota-dot')?.dataset.state==='ok');
  assert.match(await errorToggle.innerText(),/%/);assert.equal(await dot.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(22, 163, 74)');
  await errorContext.close();
  const debugContext=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:true});
  const debugPage=await debugContext.newPage();await debugPage.clock.install();await fixture(debugPage);
  const debugErrors=[];debugPage.on('pageerror',e=>debugErrors.push(e.message));
  const debugToggle=debugPage.locator('.dsh-codex-quota-toggle'),debugPanel=debugPage.locator('.dsh-codex-quota-panel');
  await debugToggle.hover();const debugSwitch=debugPage.getByRole('checkbox',{name:'Debug 日志'}),debugLog=debugPage.getByLabel('Host 调试日志');
  assert.equal(await debugSwitch.isChecked(),false);assert.match(await debugPanel.innerText(),/默认关闭 \/ 内存最近300条 \/ 30分钟自动停止/);assert.match(await debugPanel.innerText(),/Host 预算 20 秒 · 浏览器等待 30 秒/);
  await debugPage.clock.runFor(5000);assert.deepEqual(await debugPage.evaluate(()=>window.debugActions),[],'normal polling must never read debug API');
  await debugSwitch.check();assert.equal(await debugSwitch.isChecked(),true);assert.match(await debugLog.innerText(),/debug_enabled/);
  assert.ok((await debugPanel.boundingBox()).width<=320);
  await debugPage.clock.runFor(155000);await debugPage.waitForFunction(()=>document.querySelector('.dsh-codex-quota-debug-log')?.textContent.includes('rpc_completed'));
  assert.match(await debugLog.innerText(),/rpc_completed.*rpc.*8ms.*HTTP 200/);assert.doesNotMatch(await debugLog.innerText(),/PRIVATE/);
  assert.match(await debugPanel.innerText(),/最近 30 条/);assert.deepEqual(await debugPage.evaluate(()=>window.debugActions),['enable'],'viewing logs piggybacks only on normal status polling');
  await debugSwitch.uncheck();assert.equal(await debugSwitch.isChecked(),false);assert.match(await debugLog.innerText(),/debug_disabled/);
  async function exported(){const pending=debugPage.waitForEvent('download');await debugPage.getByRole('button',{name:'导出 JSON'}).click();const download=await pending;assert.equal(download.suggestedFilename(),'codex-quota-debug.json');const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  let exportedLog=await exported();assert.equal(exportedLog.schemaVersion,1);assert.ok(exportedLog.host.entries.length>30,'explicit export reads full Host log');assert.equal(exportedLog.host.enabled,false);assert.ok(exportedLog.client.entries.length>0);
  assert.equal(exportedLog.config.clientRpcTimeoutMs,30000);assert.equal(exportedLog.config.timeoutMs,20000);assert.equal(exportedLog.config.pollIntervalMs,5000);
  assert.doesNotMatch(JSON.stringify(exportedLog),/PRIVATE|windows|credits|remainingPercent|Authorization|account|token/);
  const clientCount=exportedLog.client.entries.length;await debugPage.clock.runFor(10000);exportedLog=await exported();assert.equal(exportedLog.client.entries.length,clientCount,'disabled client recording stays stopped');
  await debugPage.evaluate(()=>window.fixtureDebugFail=true);exportedLog=await exported();assert.equal(exportedLog.hostReadFailed,true);assert.equal(exportedLog.client.entries.length,clientCount);assert.doesNotMatch(JSON.stringify(exportedLog),/PRIVATE|Authorization|account|token/);await debugPage.evaluate(()=>window.fixtureDebugFail=false);
  await debugPage.getByRole('button',{name:'清空日志'}).click();assert.equal(await debugLog.innerText(),'暂无日志');exportedLog=await exported();assert.equal(exportedLog.host.entries.length,0);assert.equal(exportedLog.client.entries.length,0);
  await debugPage.evaluate(()=>window.fixtureDebugFail=true);await debugSwitch.click();await debugPage.getByRole('status').waitFor();assert.equal(await debugSwitch.isChecked(),false);assert.match(await debugPanel.innerText(),/调试操作失败/);assert.doesNotMatch(await debugPanel.innerText(),/PRIVATE_DEBUG_FAILURE/);
  await debugPage.evaluate(()=>{window.fixtureDebugFail=false;window.fixtureDebugTtlMs=1000;});await debugSwitch.check();assert.equal(await debugSwitch.isChecked(),true);
  const beforeTTL=await debugPage.evaluate(()=>window.rpcCalls);await debugPage.clock.runFor(1000);assert.equal(await debugSwitch.isChecked(),false,'local TTL turns switch off even before fresh Host metadata');assert.equal(await debugPage.evaluate(()=>window.rpcCalls),beforeTTL,'TTL does not issue another RPC');
  assert.equal(debugErrors.length,0);await debugContext.close();
  console.log(JSON.stringify({debugDefaultOff:true,debugToggle:true,debugLatest30:true,debugFullSafeDownload:true,debugOfflineFallback:true,debugClearBoth:true,debugDisableRetainsLogs:true,debugTTL:true,debugGenericErrors:true,quietRedErrors:true,noDataDotOnly:true,recoveryGreen:true,fixture:'pass',resetCountdown:true,detailWindowLabelsRetained:true,hoverOpens:true,gapKeepsOpen:true,panelHoverKeepsOpen:true,mouseCloseMs,desktopClickNoToggle:true,keyboard:true,touchTap:true,positionsRetained:true,modalAvoidance:true,pollIntervalMs:5000,unmountStopsPolling:true,pageErrors:0}));
} finally { await browser.close(); }
