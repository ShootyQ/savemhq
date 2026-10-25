'use strict';
const crypto = require('node:crypto');
const TYPES = ['clients','opportunities','estimates','jobs','visits','expenses','changes','invoices'];
const ADMIN_EMAIL = 'andrewpcarlson85@gmail.com';
const routes = {clients:'Clients',opportunities:'Clients',estimates:'Estimates',jobs:'Jobs',visits:'Jobs',expenses:'Expenses',changes:'Jobs',invoices:'Jobs'};
function portalLink(type,id,record) {
  const selected = ['visits','changes','invoices'].includes(type) ? record.jobId : type === 'opportunities' ? record.clientId : id;
  return `https://www.savemhq.com/business.html?view=${routes[type]}&record=${encodeURIComponent(selected || '')}`;
}
function localTime(date, time='12:00', timezone='America/Chicago') {
  if (!date) return null;
  const expected=Date.parse(`${date}T${time}:00Z`); if(!Number.isFinite(expected))return null;
  let value=expected;
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++){const p=Object.fromEntries(formatter.formatToParts(new Date(value)).map(p=>[p.type,p.value]));const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);value+=expected-represented;}
  return new Date(value);
}
function project(type,id,r,context={}) {
  if(!r || r.archived || r.voided)return null;
  let title;let date;let time;let status='next';
  const job=context.job;const client=context.client;
  if(type==='opportunities' && client?.archived)return null;
  if(type==='clients' && r.followUpDate){title=`Follow up with ${r.name}`;date=r.followUpDate;}
  if(type==='opportunities' && r.followUpDate){title=`Follow up: ${r.title}`;date=r.followUpDate;}
  if(type==='estimates'){
    if(r.status==='issued'){title=`Follow up on estimate: ${r.title}`;date=r.expiresDate;}
    if(r.status==='accepted' && !r.jobId)title=`Create job for accepted estimate: ${r.title}`;
  }
  if(type==='jobs' && r.status==='completed' && !r.invoiceId)title=`Create final invoice: ${r.title}`;
  if(type==='jobs' && !['completed','cancelled'].includes(r.status)){title=`Complete job: ${r.title}`;status=r.status==='on-hold'?'waiting':r.status==='in-progress'?'in-progress':'next';}
  if(type==='visits' && job && !['completed','cancelled'].includes(job.status)){title=`Job visit: ${job.title}`;date=r.date;time=r.start;}
  if(type==='expenses' && !(r.allocations || []).length)title=`Assign receipt: ${r.merchant || r.category || 'Expense'}`;
  if(type==='changes' && r.status==='draft' && job && !['completed','cancelled'].includes(job.status))title=`Get approval: ${r.description}`;
  if(type==='invoices' && r.status==='issued' && job?.invoiceId===id){
    const paid=(context.payments||[]).filter(p=>!p.voided).reduce((sum,p)=>sum+p.amountCents,0);
    const balance=r.document.totalCents-paid;
    if(balance>0){title=`Collect invoice ${r.document.number}: $${(balance/100).toFixed(2)}`;date=r.document.dueDate;}
  }
  if(!title)return null;
  return {title:title.slice(0,180),status,dueDate:localTime(date,time,context.timezone),priority:'medium',notes:`Managed by Business portal. Update the business record to resolve or change this reminder.\n${portalLink(type,id,r)}`};
}
function createDeskSync(db, timestamp=date=>date, clock=()=>new Date()) {
  async function one(uid,type,id) {
    if(!TYPES.includes(type))return;
    const root=db.collection('businesses').doc(uid);
    const taskRef=db.collection('workrooms').doc(uid).collection('tasks').doc(`business_${type}_${id}`);
    return db.runTransaction(async tx=>{
      const approval=(await tx.get(db.collection('loginApprovals').doc(uid))).data();
      const settings=(await tx.get(root.collection('settings').doc('profile'))).data()||{};
      const source=(await tx.get(root.collection(type).doc(id))).data();
      const existing=(await tx.get(taskRef)).data();
      const allowed=approval?.status==='approved' && approval.accessSections?.includes('business') && (approval.accessSections.includes('desk')||approval.email===ADMIN_EMAIL) && settings.deskSyncEnabled!==false;
      const context={timezone:settings.timezone||'America/Chicago'};
      if(source?.jobId)context.job=(await tx.get(root.collection('jobs').doc(source.jobId))).data();
      if(source?.clientId)context.client=(await tx.get(root.collection('clients').doc(source.clientId))).data();
      if(type==='invoices' && source?.jobId)context.payments=(await tx.get(root.collection('payments').where('jobId','==',source.jobId))).docs.map(s=>s.data());
      const desired=allowed?project(type,id,source,context):null;
      if(!desired && !existing)return;
      // Never overwrite an unrelated manually-created task, even on an ID collision.
      if(existing && existing.source!=='business')return;
      const hash=(desired?'active:':'closed:')+crypto.createHash('sha256').update(JSON.stringify({desired,allowed})).digest('hex');
      if(existing?.ingestionHash===hash)return;
      const now=timestamp(clock());
      const data=desired?{...desired,dueDate:desired.dueDate?timestamp(desired.dueDate):null,completedAt:null}:{title:allowed?(existing?.title||'Business reminder'):'Business reminder (sync unavailable)',notes:allowed?(existing?.notes||''):'Business sync is disabled or access has changed.',dueDate:existing?.dueDate||null,priority:existing?.priority||'medium',status:'done',completedAt:now};
      tx.set(taskRef,{...data,projectId:'',source:'business',ingestionHash:hash,createdAt:existing?.createdAt||now,updatedAt:now});
    });
  }
  async function changed(uid,type,id,previous={}) {
    const root=db.collection('businesses').doc(uid);
    if(TYPES.includes(type))await one(uid,type,id);
    const current=(await root.collection(type).doc(id).get()).data()||previous;
    if(type==='payments' && current.jobId){const invoices=await root.collection('invoices').where('jobId','==',current.jobId).get();for(const doc of invoices.docs)await one(uid,'invoices',doc.id);}
    if(type==='jobs'){for(const child of ['visits','changes','invoices']){const rows=await root.collection(child).where('jobId','==',id).get();for(const doc of rows.docs)await one(uid,child,doc.id);}}
    if(type==='clients'){const rows=await root.collection('opportunities').where('clientId','==',id).get();for(const doc of rows.docs)await one(uid,'opportunities',doc.id);}
  }
  async function all(uid) {
    // Bounded reads and per-record transactions support backfills beyond 500 records.
    const root=db.collection('businesses').doc(uid);let count=0;
    for(const type of TYPES){let cursor;do{let query=root.collection(type).orderBy('__name__').limit(100);if(cursor)query=query.startAfter(cursor);const page=await query.get();for(const doc of page.docs){await one(uid,type,doc.id);count++;}cursor=page.docs.length===100?page.docs.at(-1):null;}while(cursor);}
    // Close managed tasks whose source was removed, without touching personal tasks.
    const tasks=await db.collection('workrooms').doc(uid).collection('tasks').where('source','==','business').get();
    for(const doc of tasks.docs){const match=doc.id.match(/^business_(clients|opportunities|estimates|jobs|visits|expenses|changes|invoices)_(.+)$/);if(match)await one(uid,match[1],match[2]);}
    return {processed:count};
  }
  return {one,changed,all};
}
module.exports={createDeskSync,project,localTime,portalLink,TYPES};
