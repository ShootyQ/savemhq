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
test('Desk reminders use real timestamps, remain editable under existing task rules, and close when paid',async()=>{
  const {createDeskSync}=require('../business/desk');const {Timestamp}=require('@google-cloud/firestore');const {updateDoc,serverTimestamp}=require('firebase/firestore');
  await app.doc('loginApprovals/owner').set({status:'approved',accessSections:['business','desk']});
  await app.doc('businesses/owner/jobs/j').set({title:'Repair',status:'completed',invoiceId:'i'});
  await app.doc('businesses/owner/invoices/i').set({status:'issued',jobId:'j',document:{totalCents:10000,number:'INV-1',dueDate:'2026-11-01'}});
  const sync=createDeskSync(app,date=>Timestamp.fromDate(date));await sync.changed('owner','invoices','i');
  const path='workrooms/owner/tasks/business_invoices_i';const owner=env.authenticatedContext('owner').firestore();
  await assertSucceeds(getDoc(doc(owner,path)));await assertSucceeds(updateDoc(doc(owner,path),{status:'done',completedAt:serverTimestamp()}));
  const initial=(await app.doc(path).get()).data();assert.equal(initial.status,'done');
  await sync.changed('owner','invoices','i');assert.equal((await app.doc(path).get()).data().status,'done');
  await app.doc('businesses/owner/payments/p').set({jobId:'j',amountCents:4000});await sync.changed('owner','payments','p');assert.match((await app.doc(path).get()).data().title,/60\.00/);
  await app.doc('businesses/owner/payments/p').set({jobId:'j',amountCents:10000});await sync.changed('owner','payments','p');assert.equal((await app.doc(path).get()).data().status,'done');
  await assertFails(getDoc(doc(env.authenticatedContext('other').firestore(),path)));
});
test('personal billing reads require admin identity AND matching UID; all browser writes are denied',async()=>{
  await app.doc('projectBilling/admin/clients/c').set({name:'Private billing customer'});
  const owner=env.authenticatedContext('admin',{email:'andrewpcarlson85@gmail.com'}).firestore();
  await assertSucceeds(getDoc(doc(owner,'projectBilling/admin/clients/c')));
  for(const context of [env.unauthenticatedContext(),env.authenticatedContext('other',{email:'other@example.test'}),env.authenticatedContext('admin',{email:'other@example.test'}),env.authenticatedContext('other',{email:'andrewpcarlson85@gmail.com'})])await assertFails(getDoc(doc(context.firestore(),'projectBilling/admin/clients/c')));
  await assertFails(setDoc(doc(owner,'projectBilling/admin/payments/fake'),{amountCents:50000}));
  await assertFails(getDoc(doc(owner,'businesses/owner/clients/client')));
});
test('billing startup can read a missing profile and query every initially empty collection',async()=>{
  const {collection,getDocs,query,orderBy,limit}=require('firebase/firestore');
  const db=env.authenticatedContext('admin',{email:'andrewpcarlson85@gmail.com'}).firestore();
  const profile=await assertSucceeds(getDoc(doc(db,'projectBilling/admin/settings/profile')));assert.equal(profile.exists(),false);
  for(const type of ['clients','jobs','invoices','payments']){
    const page=await assertSucceeds(getDocs(query(collection(db,'projectBilling/admin',type),orderBy('__name__'),limit(100))));assert.equal(page.size,0);
    await assertFails(getDocs(query(collection(env.authenticatedContext('other',{email:'other@example.test'}).firestore(),'projectBilling/admin',type),orderBy('__name__'),limit(100))));
  }
});
test('retired Aftercare records deny all browser identities and remain stored for backend recovery',async()=>{
  const paths=['aftercarePrograms/history','aftercarePrograms/history/students/student','aftercarePrograms/history/attendance/attendance','aftercarePrograms/history/archive/saved/deep/record'];
  for(const path of paths)await app.doc(path).set({preserved:true,status:'checked-in'});
  const identities=[env.unauthenticatedContext(),env.authenticatedContext('admin',{email:'andrewpcarlson85@gmail.com'}),env.authenticatedContext('family',{email:'savannahbcarlson@gmail.com'}),env.authenticatedContext('owner',{email:'owner@example.test'})];
  await app.doc('loginApprovals/owner').set({status:'approved',accessSections:['aftercare']});
  for(const context of identities)for(const path of paths){await assertFails(getDoc(doc(context.firestore(),path)));await assertFails(setDoc(doc(context.firestore(),path),{preserved:false}));}
  for(const path of paths)assert.equal((await app.doc(path).get()).data().preserved,true);
});
test('only admin can list accounts, grant permissions and change competition locks',async()=>{
  const {getDocs,collection,updateDoc,deleteField,serverTimestamp}=require('firebase/firestore');
  const adminDb=env.authenticatedContext('admin',{email:'andrewpcarlson85@gmail.com'}).firestore();const other=env.authenticatedContext('owner',{email:'owner@example.test'}).firestore();
  await app.doc('loginApprovals/owner').set({uid:'owner',email:'owner@example.test',status:'approved',person:null,personLabel:null,accessSections:['plates'],requestedAt:new Date('2026-01-01'),lastLoginAttemptAt:new Date('2026-01-01'),reviewedAt:null,reviewedBy:null});
  await assertSucceeds(getDocs(collection(adminDb,'loginApprovals')));await assertFails(getDocs(collection(other,'loginApprovals')));
  await assertFails(updateDoc(doc(other,'loginApprovals/owner'),{accessSections:['business','desk']}));
  await assertSucceeds(updateDoc(doc(adminDb,'loginApprovals/owner'),{status:'approved',accessSections:['business','desk','plates'],reviewedBy:'andrewpcarlson85@gmail.com',reviewedAt:serverTimestamp()}));
  const target='competitions/2026/months/january';const scores={andyStates:['MN','IA'],savannahStates:['WI'],manualCounts:{andy:28,savannah:29}};await app.doc(target).set({...scores,locked:false});
  await assertFails(updateDoc(doc(other,target),{locked:true}));
  await assertSucceeds(updateDoc(doc(adminDb,target),{locked:true,lockedAt:serverTimestamp(),lockedBy:'andrewpcarlson85@gmail.com',updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(doc(adminDb,target),{locked:false,lockedAt:deleteField(),lockedBy:deleteField(),updatedAt:serverTimestamp()}));
  const saved=(await app.doc(target).get()).data();for(const key of Object.keys(scores))assert.deepEqual(saved[key],scores[key]);assert.equal(saved.locked,false);
});
test('real admin API transactions detect concurrent access edits and preserve scores on lock/unlock',async()=>{
  const sdk=require('firebase/firestore');const Model=require('../../js/admin/model');
  const db=env.authenticatedContext('admin',{email:'andrewpcarlson85@gmail.com'}).firestore();
  const code=readFileSync(resolve(__dirname,'../../js/admin/api.js'),'utf8').replace(/^import .*;\n/gm,'').replace(/^export \{.*\};\n?/gm,'').replace(/^export /gm,'');
  const dependencies={...Object.fromEntries(['collection','doc','onSnapshot','runTransaction','serverTimestamp','deleteField'].map(name=>[name,sdk[name]])),auth:{currentUser:{uid:'admin',email:'andrewpcarlson85@gmail.com'}},db,ADMIN_EMAIL:'andrewpcarlson85@gmail.com',ACCESS_SECTIONS:[{id:'business'},{id:'desk'},{id:'plates'}],getKnownUserProfile:()=>null,initHeaderAuth:()=>{},window:{AdminModel:Model}};
  const api=Function(...Object.keys(dependencies),code+';return {saveAccess,setMonthLock};')(...Object.values(dependencies));
  await app.doc('loginApprovals/owner').set({uid:'owner',email:'owner@example.test',status:'pending',accessSections:['aftercare'],person:null,requestedAt:new Date('2026-01-01'),lastLoginAttemptAt:new Date('2026-01-01')});
  let base={...(await app.doc('loginApprovals/owner').get()).data(),id:'owner'};
  await api.saveAccess({base,draft:{person:'',accessSections:['desk','aftercare']},action:'approve'});
  let saved=(await app.doc('loginApprovals/owner').get()).data();assert.equal(saved.status,'approved');assert.deepEqual(saved.accessSections,['desk']);assert.ok(saved.reviewedAt.toDate());
  base={...saved,id:'owner'};await app.doc('loginApprovals/owner').update({lastLoginAttemptAt:new Date()});
  const results=await Promise.allSettled([api.saveAccess({base,draft:{person:'',accessSections:['business']},action:'save'}),api.saveAccess({base,draft:{person:'',accessSections:['plates']},action:'save'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const scores={andyStates:['MN'],savannahStates:['WI'],manualCounts:{andy:28,savannah:29}};await app.doc('competitions/2026/months/january').set({...scores,locked:false});
  await api.setMonthLock('january',true,false);await api.setMonthLock('january',false,true);
  saved=(await app.doc('competitions/2026/months/january').get()).data();for(const key of Object.keys(scores))assert.deepEqual(saved[key],scores[key]);assert.equal(saved.locked,false);assert.equal(saved.lockedAt,undefined);
});
