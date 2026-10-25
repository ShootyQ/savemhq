const {test,before,after,beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds} = require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc} = require('firebase/firestore');
const {ref,uploadBytes,getBytes,deleteObject} = require('firebase/storage');
const { Firestore } = require('@google-cloud/firestore');
const {createService} = require('../business/service');
const PROJECT='demo-business';let env;let service;let app;
before(async()=>{
  env=await initializeTestEnvironment({projectId:PROJECT,firestore:{rules:readFileSync(resolve(__dirname,'../../firestore.rules'),'utf8')},storage:{rules:readFileSync(resolve(__dirname,'../../storage.rules'),'utf8')}});
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('This suite requires the Firestore emulator');
  app=new Firestore({projectId:PROJECT});service=createService(app);
});
after(async()=>{await env?.cleanup();await app?.terminate();});
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for(const [uid,status,sections] of [['owner','approved',['business']],['other','approved',['business']],['pending','pending',['business']],['revoked','revoked',['business']],['desk','approved',['desk']]])await setDoc(doc(db,'loginApprovals',uid),{status,accessSections:sections});
    await setDoc(doc(db,'businesses/owner/clients/client'),{name:'Private client'});
    await setDoc(doc(db,'businesses/owner/estimates/estimate'),{status:'issued',document:{number:'EST-0001'}});
  });
});
test('only approved owner can read business records; no client can mutate financial records',async()=>{
  const owner=env.authenticatedContext('owner').firestore();
  await assertSucceeds(getDoc(doc(owner,'businesses/owner/clients/client')));
  for(const context of [env.unauthenticatedContext(),...['other','pending','revoked','desk'].map(uid=>env.authenticatedContext(uid))])await assertFails(getDoc(doc(context.firestore(),'businesses/owner/clients/client')));
  for(const path of ['estimates/estimate','clients/client','payments/fake','invoices/fake','settings/profile','requests/fake'])await assertFails(setDoc(doc(owner,'businesses/owner/'+path),{status:'accepted'}));
});
test('receipt uploads and authenticated reads reject other owners, revoked users, invalid formats, overwrites and oversize files',async()=>{
  const path='businesses/owner/receipts/'+Date.now()+'.jpg';
  const owner=env.authenticatedContext('owner').storage();
  await assertSucceeds(uploadBytes(ref(owner,path),new Uint8Array([1,2,3]),{contentType:'image/jpeg'}));
  await assertSucceeds(getBytes(ref(owner,path)));
  await assertFails(uploadBytes(ref(owner,path),new Uint8Array([4]),{contentType:'image/jpeg'}));
  await assertFails(deleteObject(ref(owner,path)));
  for(const context of [env.unauthenticatedContext(),...['other','pending','revoked','desk'].map(uid=>env.authenticatedContext(uid))]){
    await assertFails(getBytes(ref(context.storage(),path)));
    await assertFails(uploadBytes(ref(context.storage(),path+'x'),new Uint8Array([1]),{contentType:'image/jpeg'}));
  }
  await assertFails(uploadBytes(ref(owner,'businesses/owner/receipts/bad.html'),new Uint8Array([1]),{contentType:'text/html'}));
  await assertFails(uploadBytes(ref(owner,'businesses/owner/receipts/large.jpg'),new Uint8Array(10*1024*1024+1),{contentType:'image/jpeg'}));
});
test('real Firestore transactions allocate unique numbers, deduplicate jobs and preserve issued revisions',async()=>{
  let n=0;const send=(action,payload={},extra={})=>service('owner',{action,payload,requestId:'actual'+(++n),...extra});
  await send('settings',{name:'Test craft'});
  for(const id of ['one','two','three'])await send('save',{clientId:'client',title:'Repair',lines:[{description:'Work',minutes:60,costRateCents:2500,priceCents:10000}]},{collection:'estimates',id});
  await Promise.all(['one','two','three'].map(id=>send('issueEstimate',{}, {id})));
  const db=app;
  const docs=await Promise.all(['one','two','three'].map(id=>db.doc(`businesses/owner/estimates/${id}`).get()));
  assert.equal(new Set(docs.map(s=>s.data().document.number)).size,3);
  await send('estimateDecision',{status:'accepted',date:'2026-10-25'},{id:'one'});
  const jobs=await Promise.all([send('convertJob',{}, {id:'one'}),send('convertJob',{}, {id:'one'})]);
  assert.equal(jobs[0].id,jobs[1].id);
  assert.ok((await db.doc('businesses/owner/estimates/one/revisions/issued').get()).exists);
  await assert.rejects(send('save',{clientId:'client',title:'Tamper',lines:[{description:'x',priceCents:1}]},{collection:'estimates',id:'one'}),/immutable|changed/);
});
test('real Firestore job actuals, change approval, invoice replacement and payments remain consistent',async()=>{
  let n=0;const send=(action,payload={},extra={})=>service('owner',{action,payload,requestId:'flow'+(++n),...extra});
  await send('settings',{name:'Pilot business',costRateCents:3000,overheadPercent:10});
  await send('save',{clientId:'client',title:'Real emulator lifecycle',lines:[{description:'Repair',minutes:120,costRateCents:3000,priceCents:20000,taxable:true}],taxPercent:5,overheadPercent:10},{collection:'estimates',id:'flowestimate'});
  await send('issueEstimate',{}, {id:'flowestimate'});await send('estimateDecision',{status:'accepted',date:'2026-10-25'},{id:'flowestimate'});const job=(await send('convertJob',{}, {id:'flowestimate'})).id;
  await send('save',{jobId:job,date:'2026-10-25',minutes:150,kind:'work'},{collection:'timeEntries'});
  await send('save',{amountCents:1500,date:'2026-10-25',category:'materials',allocations:[{jobId:job,amountCents:1500}]},{collection:'expenses'});
  const invoice=await send('issueInvoice',{date:'2026-10-25',dueDate:'2026-11-01'},{id:job});
  const change=await send('save',{jobId:job,description:'Added trim',priceCents:3000,costCents:1000,minutes:30,taxable:true,costCategory:'materials'},{collection:'changes'});
  await send('approveChange',{date:'2026-10-25'},{id:change.id});
  await send('recordPayment',{jobId:job,amountCents:5000,date:'2026-10-25',method:'Cash'},{requestId:'realdeposit'});
  const replacement=await send('issueInvoice',{date:'2026-10-25',dueDate:'2026-11-01',replace:true,reason:'Approved additional work'},{id:job});
  const old=await app.doc(`businesses/owner/invoices/${invoice.id}`).get();const current=await app.doc(`businesses/owner/invoices/${replacement.id}`).get();
  assert.equal(old.data().status,'void');assert.equal(current.data().document.totalCents,24150);assert.equal(current.data().replacesId,invoice.id);
  const saved=await app.doc(`businesses/owner/jobs/${job}`).get();assert.equal(saved.data().needsInvoiceReplacement,false);
  await send('voidEntry',{reason:'Payment entered twice'},{collection:'payments',id:'realdeposit'});
  assert.equal((await app.doc('businesses/owner/payments/realdeposit').get()).data().voided,true);
});
