import * as API from './api.js';
import { escape as e, money, preview } from '../business/documents.js';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
const $ = q => document.querySelector(q);
const F = window.BusinessFinance;
const views = ['Overview','Customers','Projects','Invoices','Settings'];
const labels = {scheduled:'Planned','in-progress':'Active','on-hold':'On hold',completed:'Complete',cancelled:'Cancelled'};
const state = { allowed:false, view:'Overview', selected:null, data:{}, settings:{}, page:0, form:null, generation:0 };
const all = type => state.data[type] || [];
const find = (type,id) => all(type).find(v=>v.id===id);
const customer = id => find('clients',id)?.name || 'Customer';
const projectPayments = id => all('payments').filter(p=>p.jobId===id);
const balance = invoice => F.paymentsBalance(invoice.document.totalCents,projectPayments(invoice.jobId));
const btn = (label,attrs='',primary=false) => `<button type="button" class="${primary?'':'secondary'}" ${attrs}>${e(label)}</button>`;
const empty = (title,copy) => `<div class="empty"><strong>${e(title)}</strong>${e(copy)}</div>`;
const head = (title,actions='') => `<div class="section-head"><h2>${e(title)}</h2><div class="actions">${actions}</div></div>`;
const pill = (status,label=status) => `<span class="pill ${e(status)}">${e(label)}</span>`;
const row = (title,copy,actions='') => `<div class="row"><div><strong>${e(title)}</strong><p><small>${e(copy)}</small></p></div><div class="actions">${actions}</div></div>`;
function notice(text='',error=false){$('#notice').textContent=text;$('#notice').className=error?'error':'';}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:state.settings.timezone||'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function dueDate(){const date=new Date(today()+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+14);return date.toISOString().slice(0,10);}
async function load(){
  const generation=++state.generation;
  const [settings,...records]=await Promise.all([API.record('settings','profile'),...['clients','jobs','invoices','payments'].map(API.list)]);
  if(!state.allowed || generation!==state.generation)return;
  state.settings=settings||{};['clients','jobs','invoices','payments'].forEach((key,i)=>{state.data[key]=records[i];});
  $('#billing-name').textContent=state.settings.name||'Your independent work';render();
}
async function navigate(view,selected=null){state.view=view;state.selected=selected;state.page=0;$('#page-title').textContent=view;$('#navigation').innerHTML=views.map(v=>`<button data-view="${v}" ${v===view?'aria-current="page"':''}>${v}</button>`).join('');$('#content').innerHTML=empty('Loading','Getting your billing records…');try{await load();}catch(err){notice(err.message,true);$('#content').innerHTML=btn('Retry loading','data-reload');}}
function paged(records,renderRow){const sorted=[...records].sort((a,b)=>(b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||''));return sorted.slice(state.page*25,(state.page+1)*25).map(renderRow).join('')+(sorted.length>25?`<div class="section-head">${btn('Previous',`data-page="${Math.max(0,state.page-1)}" ${!state.page?'disabled':''}`)}<span>Page ${state.page+1} of ${Math.ceil(sorted.length/25)}</span>${btn('Next',`data-page="${state.page+1}" ${(state.page+1)*25>=sorted.length?'disabled':''}`)}</div>`:'');}
function invoiceRow(i){const b=balance(i);return row(i.document.number,`${customer(i.clientId)} · ${money(i.document.totalCents)} · ${i.status==='void'?'Voided':`Due ${i.document.dueDate} · ${money(b.balanceCents)} remaining`}`,pill(i.status==='void'?'void':b.status)+btn('Preview / PDF',`data-preview="${i.id}"`)+btn('Project',`data-project="${i.jobId}"`));}
function projectRow(p){return row(p.title,`${customer(p.clientId)} · ${money(p.chargeCents)}${p.targetDate?' · Target '+p.targetDate:''}`,pill(p.status,labels[p.status])+btn('Open project',`data-project="${p.id}"`));}
function render(){
  if(!state.settings.name && state.view!=='Settings'){$('#content').innerHTML=`<section class="panel">${empty('Put your name on it','Set the billing name, contact details, and payment instructions you want on your invoices.')}${btn('Set up billing','data-view="Settings"',true)}</section>`;return;}
  const activeInvoices=all('invoices').filter(i=>i.status!=='void');
  if(state.view==='Overview'){
    const unpaid=activeInvoices.filter(i=>balance(i).balanceCents>0);
    const activeProjects=all('jobs').filter(j=>!['completed','cancelled'].includes(j.status));
    $('#content').innerHTML=`<div class="cards">${[['Active projects',activeProjects.length,'Work in progress'],['Project fees',money(F.sum(activeProjects.map(j=>j.chargeCents))),'Across active projects'],['Outstanding',money(F.sum(unpaid.map(i=>balance(i).balanceCents))),'Issued invoice balances'],['Collected',money(F.sum(all('payments').filter(p=>!p.voided).map(p=>p.amountCents))),'Recorded payments']].map(([label,value,copy])=>`<section class="card"><span class="eyebrow">${label}</span><strong>${value}</strong><small>${copy}</small></section>`).join('')}</div><div class="grid"><section class="panel">${head('Your current work',btn('New project','data-new="projects"',true))}${activeProjects.slice(0,6).map(projectRow).join('')||empty('The next project starts here','Add a customer, describe the work, and set your fee.')}</section><section class="panel">${head('Awaiting payment',btn('All invoices','data-view="Invoices"'))}${unpaid.slice(0,6).map(invoiceRow).join('')||empty('Nothing outstanding','Unpaid invoices will appear here.')}</section></div>`;
  }
  if(state.view==='Customers'){
    const c=find('clients',state.selected);
    $('#content').innerHTML=c?`<div class="section-head">${btn('← Customers','data-view="Customers"')}${btn('Edit customer',`data-edit="clients" data-id="${c.id}"`)}</div><section class="panel detail-section"><p class="eyebrow">Customer ${c.archived?'· Archived':''}</p><h2>${e(c.name)}</h2><p>${e(c.email)}${c.phone?' · '+e(c.phone):''}</p><p class="preserve">${e(c.address)}</p>${c.notes?`<p class="private-note">${e(c.notes)}</p>`:''}</section><section class="panel detail-section">${head('Projects',btn('New project',`data-new="projects" data-client="${c.id}"`,true))}${all('jobs').filter(j=>j.clientId===c.id).map(projectRow).join('')||empty('No projects yet','Start with a scope and a fixed fee.')}</section><section class="panel">${head('Invoices')}${all('invoices').filter(i=>i.clientId===c.id).map(invoiceRow).join('')||empty('No invoices yet','Create one from a project when you’re ready.')}</section>`:`<section class="panel">${head('People you work with',btn('Add customer','data-new="clients"',true))}${paged(all('clients'),c=>row(c.name,`${c.email||c.phone||'No contact details yet'}${c.archived?' · Archived':''}`,btn('Open customer',`data-customer="${c.id}"`)))||empty('Keep your customers together','Contact details, projects, and invoices in one place.')}</section>`;
  }
  if(state.view==='Projects'){
    const p=find('jobs',state.selected);
    if(!p){$('#content').innerHTML=`<section class="panel">${head('A clear scope. A clear price.',btn('New project','data-new="projects"',true))}${paged(all('jobs'),projectRow)||empty('Your next paid project','No estimating spreadsheets required. Just the work and your fee.')}</section>`;return;}
    const payments=projectPayments(p.id);const current=find('invoices',p.invoiceId);const paid=F.sum(payments.filter(x=>!x.voided).map(x=>x.amountCents));
    $('#content').innerHTML=`<div class="section-head">${btn('← Projects','data-view="Projects"')}<div class="actions">${btn('Edit project',`data-edit="projects" data-id="${p.id}"`)}${btn(current?'Replace invoice':'Create invoice',`data-invoice="${p.id}"`,true)}</div></div><section class="panel detail-section"><div class="customer-card"><div><p class="eyebrow">${e(customer(p.clientId))}</p><h2>${e(p.title)}</h2>${pill(p.status,labels[p.status])}${p.targetDate?`<p>Target date: ${e(p.targetDate)}</p>`:''}</div><div><span class="eyebrow">Project fee</span><p class="project-fee">${money(p.chargeCents)}</p></div></div><h3>Scope of work</h3><p class="scope-copy">${e(p.scope)}</p>${p.notes?`<h3>Private notes</h3><p class="private-note">${e(p.notes)}</p>`:''}${p.needsInvoiceReplacement?'<p class="error">The scope or fee changed after invoicing. Replace the invoice to send the updated version; the issued invoice has not changed.</p>':''}</section><div class="grid"><section class="panel">${head('Invoices')}${all('invoices').filter(i=>i.jobId===p.id).map(invoiceRow).join('')||empty('Ready when you are','Create a branded invoice directly from this project.')}</section><section class="panel">${head('Payments',btn('Record payment',`data-payment="${p.id}"`))}<p><strong>${money(paid)}</strong> received${current?` · <strong>${money(balance(current).balanceCents)}</strong> invoice balance`:''}</p>${payments.map(x=>row(`${money(x.amountCents)} · ${x.method}`,`${x.date}${x.reference?' · '+x.reference:''}${x.voided?' · Voided':''}`,x.voided?'':btn('Void',`data-void="${x.id}"`))).join('')||empty('Deposits count too','Record payments as they arrive. No online processing is connected.')}</section></div>`;
  }
  if(state.view==='Invoices')$('#content').innerHTML=`<section class="panel">${head('Send something professional',btn('Projects','data-view="Projects"'))}${paged(all('invoices'),invoiceRow)||empty('Your first invoice is a project away','Choose a project and click Create invoice.')}</section>`;
  if(state.view==='Settings')$('#content').innerHTML=`<section class="panel">${head('Your billing details',btn(state.settings.name?'Edit details':'Set up billing','data-settings',true))}<h3>${e(state.settings.name||'Your business or display name')}</h3><p class="preserve">${e(state.settings.contact||'Add the contact information to show on invoices.')}</p><h3>Payment instructions</h3><p class="preserve">${e(state.settings.paymentInstructions||'Add how customers should pay you.')}</p><h3>Default terms</h3><p class="preserve">${e(state.settings.terms||'Optional terms for your invoices.')}</p><p class="help">Your project billing is separate from the handyman portal. Payments are recorded manually. Prices are USD; this simple portal does not add sales tax.</p></section>`;
}
const input=(name,label,value='',type='text',attrs='')=>`<label>${e(label)}<input name="${name}" type="${type}" value="${e(value??'')}" ${attrs}></label>`;
const area=(name,label,value='')=>`<label class="wide">${e(label)}<textarea name="${name}">${e(value??'')}</textarea></label>`;
const select=(name,label,options,value)=>`<label>${e(label)}<select aria-label="${e(label)}" name="${name}" required>${options.map(([id,label])=>`<option value="${e(id)}" ${id===value?'selected':''}>${e(label)}</option>`).join('')}</select></label>`;
function edit(type,v={}){
  if(type==='projects'&&!all('clients').some(c=>!c.archived)){notice('Add a customer first.');navigate('Customers');return;}
  state.form={type,original:v,requestId:crypto.randomUUID(),lastInput:''};
  $('#editor-title').textContent=({settings:'Billing details',clients:v.id?'Edit customer':'Add customer',projects:v.id?'Edit project':'New project',invoice:v.invoiceId?'Replace invoice':'Create invoice',payment:'Record payment'})[type];
  let fields='';
  if(type==='settings')fields=input('name','Billing name',v.name,'text','required maxlength="120"')+input('invoicePrefix','Invoice number prefix',v.invoicePrefix||'INV','text','required maxlength="12"')+area('contact','Contact details shown on invoices',v.contact)+area('paymentInstructions','Payment instructions',v.paymentInstructions)+area('terms','Default invoice terms',v.terms);
  if(type==='clients')fields=input('name','Customer name',v.name,'text','required maxlength="120"')+input('email','Email',v.email,'email')+input('phone','Phone',v.phone,'tel')+area('address','Billing address',v.address)+area('notes','Private customer notes',v.notes)+`<label class="check"><input name="archived" type="checkbox" ${v.archived?'checked':''}>Archive customer</label>`;
  if(type==='projects')fields=select('clientId','Customer',[['','Choose a customer'],...all('clients').filter(c=>!c.archived||c.id===v.clientId).map(c=>[c.id,c.name])],v.clientId||'')+input('title','Project name',v.title,'text','required maxlength="160"')+area('scope','Scope shown on invoice',v.scope)+input('chargeCents','Project fee ($)',((v.chargeCents||0)/100).toFixed(2),'number','min="0" step="0.01" required')+select('status','Project status',Object.entries(labels),v.status||'scheduled')+input('targetDate','Target date (optional)',v.targetDate,'date')+area('notes','Private project notes',v.notes);
  if(type==='invoice')fields=input('date','Invoice date',today(),'date','required')+input('dueDate','Payment due date',dueDate(),'date','required')+area('terms','Terms shown on invoice',state.settings.terms)+(v.invoiceId?area('reason','Why is this invoice being replaced?'):'')+`<p class="help wide">Invoice total: ${money(v.chargeCents)}. ${v.invoiceId?'The old invoice will be marked void; payment history stays with the project.':'The issued document preserves this scope and fee.'}</p>`;
  if(type==='payment')fields=input('amountCents','Payment amount ($)','0.00','number','min="0.01" step="0.01" required')+input('date','Date received',today(),'date','required')+select('method','Payment method',['Cash','Check','Bank transfer','Card (record only)','Other'].map(x=>[x,x]),'Bank transfer')+input('reference','Reference / note');
  $('#editor-fields').innerHTML=fields;$('#form-status').textContent='';$('#form-status').className='';$('#save-record').disabled=false;$('#editor').showModal();
}
$('#editor-form').addEventListener('submit',async event=>{
  event.preventDefault();const f=state.form;if(!f||$('#save-record').disabled)return;$('#save-record').disabled=true;$('#form-status').textContent='Saving…';$('#form-status').className='';
  try{
    const p={};$('#editor-fields').querySelectorAll('[name]').forEach(el=>{p[el.name]=el.type==='checkbox'?el.checked:el.type==='number'?Math.round(Number(el.value)*100):el.value;});p.version=f.original.version||0;
    let request={action:'save',collection:'clients',id:f.original.id,payload:p};
    if(f.type==='settings')request={action:'settings',payload:p};
    if(f.type==='projects')request={action:'saveProject',id:f.original.id,payload:p};
    if(f.type==='invoice')request={action:'issueInvoice',id:f.original.id,payload:{...p,replace:Boolean(f.original.invoiceId)}};
    if(f.type==='payment')request={action:'recordPayment',payload:{...p,jobId:f.original.id}};
    const fingerprint=JSON.stringify(request);if(f.lastInput&&f.lastInput!==fingerprint)f.requestId=crypto.randomUUID();f.lastInput=fingerprint;
    const result=await API.command({...request,requestId:f.requestId});$('#editor').close();state.form=null;notice('Saved.');
    if(f.type==='projects')await navigate('Projects',result.id);else await load();
  }catch(err){$('#form-status').textContent=err.message+' Your entries are still here; correct them or retry.';$('#form-status').className='error';}
  finally{$('#save-record').disabled=false;}
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||!state.allowed)return;const d=button.dataset;
  try{
    if(d.view)await navigate(d.view);
    if(d.reload!==undefined)await load();
    if(d.page!==undefined){state.page=Number(d.page);render();}
    if(d.customer)await navigate('Customers',d.customer);
    if(d.project)await navigate('Projects',d.project);
    if(d.new)edit(d.new,{clientId:d.client||''});
    if(d.edit)edit(d.edit,find(d.edit==='projects'?'jobs':d.edit,d.id));
    if(d.settings!==undefined)edit('settings',state.settings);
    if(d.invoice)edit('invoice',find('jobs',d.invoice));
    if(d.payment)edit('payment',find('jobs',d.payment));
    if(d.preview){const invoice=find('invoices',d.preview);if(invoice.status==='void'&&!confirm('This invoice is void. View it for historical reference?'))return;await preview(invoice,projectPayments(invoice.jobId));}
    if(d.void){const reason=prompt('Why are you voiding this payment? It will remain in the history.');if(!reason)return;button.disabled=true;await API.command({action:'voidEntry',collection:'payments',id:d.void,payload:{reason},requestId:crypto.randomUUID()});notice('Payment voided.');await load();}
  }catch(err){notice(err.message,true);}finally{button.disabled=false;}
});
function closeEditor(event){event?.preventDefault();if($('#save-record').disabled)return;if(confirm('Close this form? Unsaved changes will be lost.')){$('#editor').close();state.form=null;}}
$('#close-editor').onclick=closeEditor;$('#cancel-editor').onclick=closeEditor;$('#editor').addEventListener('cancel',closeEditor);
$('#close-preview').onclick=()=>$('#preview').close();$('#print-document').onclick=()=>window.print();
$('#sign-in').onclick=async()=>{try{await signInWithPopup(API.auth,new GoogleAuthProvider());}catch(err){$('#gate-message').textContent=err.message;}};
$('#sign-out').onclick=()=>signOut(API.auth);
onAuthStateChanged(API.auth,async user=>{
  state.allowed=false;state.generation++;state.data={};state.settings={};state.form=null;const generation=state.generation;
  $('#app').hidden=true;$('#gate').hidden=false;$('#content').replaceChildren();$('#document').replaceChildren();$('#editor').close();$('#preview').close();$('#sign-in').hidden=Boolean(user);
  if(!user){$('#gate-message').textContent='Sign in with your SavemHQ administrator account.';return;}
  try{const allowed=await API.session(user);if(generation!==state.generation)return;if(!allowed){$('#gate-message').textContent='This project billing workspace is private to the SavemHQ administrator.';return;}state.allowed=true;$('#gate').hidden=true;$('#app').hidden=false;await navigate('Overview');}catch(err){$('#gate-message').textContent=err.message;}
});
window.addEventListener('beforeunload',event=>{if(state.form){event.preventDefault();event.returnValue='';}});
