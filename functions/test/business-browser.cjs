/* UI integration harness: real portal + real service/finance with an isolated test store.
   Firebase SDK/auth transport is replaced only inside this local test server. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {Store}=require('./helpers/business-store');const {createService}=require('../business/service');
const {createDeskSync}=require('../business/desk');
const root=path.resolve(__dirname,'../..');const db=new Store();db.seed('loginApprovals/owner',{status:'approved',accessSections:['business','desk']});const service=createService(db);
const api=`export const auth={currentUser:{uid:'owner'}}; export const session=async()=>true;
async function call(action,input){const r=await fetch('/_test/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
export const syncDesk=()=>call('sync',{});export const command=input=>call('command',input);export const list=type=>call('list',{type});export const record=(type,id)=>call('record',{type,id});export const imageBlob=async()=>new Blob(['photo'],{type:'image/jpeg'});export async function upload(file,folder,progress){if(globalThis.__failUploadOnce){globalThis.__failUploadOnce=false;throw new Error('Temporary upload failure');}if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Use JPEG, PNG, or WebP');progress?.(100);return 'businesses/owner/'+folder+'/test.jpg';}`;
const server=http.createServer(async(req,res)=>{
 try {
  if(req.url.startsWith('/_test/')){let body='';for await(const c of req)body+=c;const p=JSON.parse(body);let result;
   if(req.url==='/_test/command')result=await service('owner',p);
   if(req.url==='/_test/sync')result=await createDeskSync(db).all('owner');
   if(req.url==='/_test/list')result=[...db.rows].filter(([k])=>k.startsWith('businesses/owner/'+p.type+'/')&&k.split('/').length===4).map(([k,v])=>({...v,id:k.split('/').at(-1)}));
   if(req.url==='/_test/record')result=db.read(`businesses/owner/${p.type}/${p.id}`)||null;
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
  }
  if(req.url==='/js/business/api.js'){res.setHeader('Content-Type','text/javascript');res.end(api);return;}
  const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error('Invalid path');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',err=>errors.push(err.message));page.on('dialog',dialog=>dialog.accept());
 await page.route('https://www.gstatic.com/firebasejs/**/firebase-auth.js',route=>route.fulfill({contentType:'text/javascript',body:`export const onAuthStateChanged=(auth,callback)=>{queueMicrotask(()=>callback({uid:'owner'}));};export class GoogleAuthProvider{};export const signInWithPopup=async()=>{};export const signOut=async()=>{};`}));
 const base=`http://127.0.0.1:${server.address().port}`;
 const save=async()=>{await page.locator('#save-record').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);};
 const choose=async type=>{await page.locator(`[data-new="${type}"]`).first().click();await page.locator('#editor').waitFor({state:'visible'});};
 try {
  await page.goto(base+'/business.html');await page.locator('[data-view="Settings"]').last().click();await page.locator('[data-settings]').click();
  await page.getByLabel('Business name',{exact:true}).fill('Copper & Oak Handyman');await page.getByLabel('Business contact details').fill('hello@example.test\n(555) 010-2026');await page.getByLabel('Owner labor cost / hour ($)').fill('30');await page.getByLabel('Default client terms').fill('Thank you for trusting us with your home.');await save();
  await page.locator('#navigation [data-view="Clients"]').click();await choose('clients');await page.getByLabel('Client name',{exact:true}).fill('Jordan Client');await page.getByLabel('Billing address').fill('123 Sample Lane');await save();
  await page.locator('#navigation [data-view="Estimates"]').click();await choose('estimates');await page.getByLabel('Client',{exact:true}).selectOption({label:'Jordan Client'});await page.getByLabel('Job title',{exact:true}).fill('Bathroom refresh');await page.getByLabel('Client-visible description').fill('Repair damaged drywall and prepare a smooth, paint-ready finish.');await page.getByLabel('Planned labor minutes').fill('120');await page.getByLabel('Material quantity').fill('2');await page.getByLabel('Material cost / unit ($)').fill('25');await page.getByLabel('Client selling price ($), blank = markup').fill('450');await page.getByLabel('Internal notes (never printed)').fill('PRIVATE COST NOTE');await save();
  await page.locator('[data-estimate]').first().click();await page.locator('[data-action="issueEstimate"]').click();await page.locator('[data-decision]').waitFor();await page.locator('[data-decision]').click();await save();await page.locator('[data-action="convertJob"]').click();await page.locator('[data-invoice]').waitFor();
  await page.locator('[data-new="timeEntries"]').last().click();await page.getByLabel('Duration (minutes)').fill('150');await save();
  await page.locator('[data-new="expenses"]').last().click();await page.getByLabel('Merchant',{exact:true}).fill('Hardware shop');await page.getByLabel('Receipt total ($)').fill('50');await page.getByLabel('Allocated amount ($)').fill('49');await page.locator('#save-record').click();await page.waitForFunction(()=>document.querySelector('#form-status').textContent.includes('Allocations must equal'));
  assert.equal(await page.getByLabel('Merchant',{exact:true}).inputValue(),'Hardware shop');await page.getByLabel('Allocated amount ($)').fill('50');
  await page.locator('input[name="receipt"]').setInputFiles({name:'receipt.jpg',mimeType:'image/jpeg',buffer:Buffer.from([1,2,3])});
  await page.evaluate(()=>{globalThis.__failUploadOnce=true;});await page.locator('#save-record').click();await page.waitForFunction(()=>document.querySelector('#form-status').textContent.includes('Temporary upload failure'));assert.equal(await page.getByLabel('Merchant',{exact:true}).inputValue(),'Hardware shop');await save();
  await page.locator('[data-timer="start"]').first().click();await page.waitForFunction(()=>!document.querySelector('#timer-bar').hidden);await page.reload();await page.waitForFunction(()=>!document.querySelector('#timer-bar').hidden);await page.locator('[data-timer="stop"]').click();await page.waitForFunction(()=>document.querySelector('#timer-bar').hidden);
  await page.locator('#navigation [data-view="Jobs"]').click();await page.locator('[data-job]').first().click();await page.locator('[data-new="changes"]').click();await page.getByLabel('Client-visible change scope').fill('Replace damaged trim');await page.getByLabel('Contract price adjustment ($)').fill('75');await save();await page.locator('[data-approve]').click();await save();
  await page.locator('[data-new="payments"]').click();await page.getByLabel('Amount received ($)').fill('100');await save();
  await page.locator('[data-invoice]').click();await save();await page.locator('[data-preview="invoices"]').click();await page.locator('#preview').waitFor({state:'visible'});
  const documentText=await page.locator('#document').innerText();assert.ok(documentText.includes('$525.00'));assert.ok(documentText.includes('$425.00'));assert.ok(!documentText.includes('PRIVATE COST NOTE'));assert.ok(!documentText.includes('Labor cost'));assert.ok(documentText.includes('Replace damaged trim'));
  await page.screenshot({path:'/tmp/business-invoice-desktop.png',fullPage:true});
  await page.pdf({path:'/tmp/business-invoice-letter.pdf',format:'Letter',printBackground:true});await page.pdf({path:'/tmp/business-invoice-a4.pdf',format:'A4',printBackground:true});
  await page.locator('#close-preview').click();await page.locator('#navigation [data-view="Overview"]').click();await page.screenshot({path:'/tmp/business-overview-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/business-overview-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#navigation [data-view="Calendar"]').click();await page.locator('[data-calendar-mode="week"]').click();await page.locator('[data-calendar-mode="agenda"]').click();
  await page.locator('#navigation [data-view="Reports"]').click();await page.locator('summary').click();assert.match(await page.locator('#content').innerText(),/actual/i);
  await page.locator('#navigation [data-view="Settings"]').click();await page.locator('[data-sync-desk]').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Desk actions updated'));assert.ok([...db.rows].some(([key,value])=>key.startsWith('workrooms/owner/tasks/business_invoices_')&&value.title.includes('425.00')));
  const managed=[...db.rows].find(([key])=>key.startsWith('workrooms/owner/tasks/business_invoices_'))[1];const deepLink=new URL(managed.notes.split('\n').at(-1));await page.goto(base+deepLink.pathname+deepLink.search);await page.locator('[data-invoice]').waitFor();
  // A long multi-page document exercises repeated headers and the print whitelist.
  await page.evaluate(async()=>{const {preview}=await import('/js/business/documents.js');await preview({document:{kind:'Invoice',number:'INV-LONG',date:'2026-10-25',business:{name:'Copper & Oak',contact:'Test'},client:{name:'Sample customer',address:'Address'},title:'Multi-page work',lines:Array.from({length:70},(_,i)=>({group:'Phase '+(i+1),description:'A detailed, carefully described scope of work. '.repeat(8),priceCents:10000,costRateCents:888888})),subtotalCents:700000,discountCents:0,taxCents:0,totalCents:700000,terms:'Thank you.'}});});
  await page.pdf({path:'/tmp/business-invoice-multipage.pdf',format:'A4',printBackground:true});assert.equal(await page.locator('#document tbody tr').count(),70);
  assert.deepEqual(errors,[]);console.log('PASS: browser workflow, preserved failed form, timer reload, approved change, deposit/invoice balance, private-field exclusion, mobile overflow, calendar, reports, Desk-action backfill, Letter/A4 and multi-page PDFs');
 } catch (error) { await page.screenshot({path:'/tmp/business-browser-failure.png',fullPage:true});console.error(await page.locator('body').innerText());throw error; } finally {await browser.close();server.close();}
})().catch(err=>{console.error(err);server.close();process.exitCode=1;});
