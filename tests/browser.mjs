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
    window.rpcCalls=0;window.disposers=[];
    const call=async()=>{window.rpcCalls++;return{ok:true,value:{status:'ok',errorCode:null,stale:false,updatedAt:Date.now(),nextFetchAt:Date.now()+5000,windows:[{id:'codex:primary_window',group:'codex',windowSeconds:604800,remainingPercent:100-window.rpcCalls,resetAt:Date.now()+86400000}],limitReached:false,credits:null}};};
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
  assert.equal(await badge.evaluate(el=>innerHeight-el.getBoundingClientRect().bottom),96);
  await toggle.hover();await panel.waitFor({state:'visible'});assert.match(await panel.innerText(),/剩余 99%/);
  const t=await toggle.boundingBox(),p=await panel.boundingBox();
  await page.mouse.move(t.x+t.width/2,(t.y+p.y+p.height)/2);assert.equal(await panel.isVisible(),true,'hover bridge keeps the gap open');
  await panel.hover();assert.equal(await panel.isVisible(),true,'moving inside panel must not close it');
  const out=process.env.ARTIFACT_DIR || fileURLToPath(new URL('../test-results/',import.meta.url));fs.mkdirSync(out,{recursive:true});await panel.screenshot({path:path.join(out,'quota-hover-light.png')});
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
  console.log(JSON.stringify({fixture:'pass',hoverOpens:true,gapKeepsOpen:true,panelHoverKeepsOpen:true,mouseCloseMs,desktopClickNoToggle:true,keyboard:true,touchTap:true,positionsRetained:true,modalAvoidance:true,pollIntervalMs:5000,unmountStopsPolling:true,pageErrors:0}));
} finally { await browser.close(); }
