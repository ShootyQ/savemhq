import * as API from './api.js';
const Model=window.AdminModel;
const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={authorized:false,epoch:0,tab:'people',people:[],months:[],filter:'all',search:'',page:0,initialFilter:false,editor:null,busy:false,peopleError:false,monthBusy:new Set(),monthMessages:new Map()};
let stopPeople;let stopMonths;
const profile=record=>API.getKnownUserProfile(record.email);
const protectedPerson=record=>profile(record)?.autoApprove?profile(record).person:'';
const playerName=record=>profile(record)?.displayName||({andy:'Andy',savannah:'Savannah'})[record.person]||'Unassigned';
const badge=status=>`<span class="badge ${escape(status)}">${escape(status)}</span>`;
function formatDate(value){const millis=Model.stamp(value);return millis?new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short'}).format(new Date(millis)):'Not recorded';}
function message(text='',error=false){$('#admin-notice').textContent=text;$('#admin-notice').className=error?'error':'';}
function button(label,attrs='',type='secondary'){return `<button type="button" class="button ${type}" ${attrs}>${escape(label)}</button>`;}
function renderPeople(){
  const counts={all:state.people.length,pending:0,approved:0,denied:0};state.people.forEach(p=>{const s=p.status||'pending';if(s in counts)counts[s]++;});
  $('#pending-count').textContent=counts.pending;
  $('#people-filters').innerHTML=['pending','approved','denied','all'].map(filter=>`<button type="button" data-filter="${filter}" aria-pressed="${state.filter===filter}">${filter[0].toUpperCase()+filter.slice(1)} <span>${counts[filter]}</span></button>`).join('');
  const records=Model.selectPeople(state.people.map(p=>({...p,personLabel:p.personLabel||profile(p)?.displayName||''})),state);
  state.page=Math.min(state.page,Math.max(0,Math.ceil(records.length/25)-1));
  const start=state.page*25;
  $('#people-summary').textContent=`${records.length} account${records.length===1?'':'s'}${state.search?' matching your search':''}${state.filter!=='all'?' · '+state.filter:''}`;
  $('#people-list').innerHTML=records.slice(start,start+25).map(p=>{
    const assigned=API.ACCESS_SECTIONS.filter(s=>(p.accessSections||[]).includes(s.id)).map(s=>s.label);
    return `<article class="person-row"><div class="person-identity"><strong>${escape(p.email||'Email not recorded')}</strong><small>${escape(playerName(p))}${protectedPerson(p)?' · Auto-approved':''}${p.id===API.auth.currentUser?.uid?' · You':''}</small></div>${badge(p.status||'pending')}<div class="person-sections">${escape(assigned.join(' · ')||'No sections assigned')}</div><div class="last-login"><span>Last sign-in</span>${escape(formatDate(p.lastLoginAttemptAt))}</div>${button('Manage',`data-person="${escape(p.id)}" aria-label="Manage ${escape(p.email||'account')}"`)}</article>`;
  }).join('')||`<div class="empty"><strong>${state.search?'No matches':state.filter==='pending'?'No requests waiting':'No accounts here'}</strong>${state.search?'Try a different email or player name.':state.filter==='pending'?'Choose another filter to manage existing accounts.':'Accounts appear here after signing in to SavemHQ.'}</div>`;
  $('#people-pagination').innerHTML=records.length>25?`${button('Previous',`data-page="${Math.max(0,state.page-1)}" ${state.page===0?'disabled':''}`)}<span>${start+1}–${Math.min(start+25,records.length)} of ${records.length}</span>${button('Next',`data-page="${state.page+1}" ${start+25>=records.length?'disabled':''}`)}`:'';
}
function refreshConflict(){
  if(!state.editor)return;
  const current=state.people.find(p=>p.id===state.editor.base.id);
  if(current){$('#editor-account-state').innerHTML=badge(current.status||'pending');$('#editor-last-login').textContent=formatDate(current.lastLoginAttemptAt);$('#editor-reviewed-at').textContent=formatDate(current.reviewedAt);$('#editor-reviewed-by').textContent=current.reviewedBy||'Not yet reviewed';}
  const conflict=!current||Model.managed(current)!==Model.managed(state.editor.base);
  $('#editor-conflict').hidden=!conflict;
  $('#editor-conflict').textContent=current?'Access was changed since you opened this account. Your choices are preserved. Reload the latest account before saving.':'This account no longer exists. Close this editor and refresh the list.';
  $('#reload-person').hidden=!conflict;$('#reload-person').disabled=!current||state.busy;
}
function subscribePeople(){
  stopPeople?.();state.peopleError=false;const epoch=state.epoch;
  $('#people-list').innerHTML='<div class="empty">Loading accounts…</div>';
  stopPeople=API.watchPeople(records=>{
    if(!state.authorized||epoch!==state.epoch)return;
    state.people=records;
    if(!state.initialFilter){state.filter=records.some(r=>(r.status||'pending')==='pending')?'pending':'all';state.initialFilter=true;}
    renderPeople();refreshConflict();
  },error=>{if(epoch!==state.epoch)return;state.peopleError=true;message(`Unable to load accounts: ${error.message}`,true);$('#people-list').innerHTML='<div class="empty"><strong>Accounts unavailable</strong>Check your connection and retry.</div>'+button('Retry accounts','data-retry-people');});
}
function renderMonths(){
  $('#months-list').innerHTML=Model.monthRows(state.months).map(m=>`<article class="month-row"><div class="month-main"><div><h3>${m.name} ${badge(m.locked?'locked':'open')}</h3><p>${m.manual?'Manual score':'Logged states'} · Andy ${m.andy} · Savannah ${m.savannah}</p></div>${button(m.locked?'Unlock':'Lock',`data-month="${m.id}" ${state.monthBusy.has(m.id)?'disabled':''}`,m.locked?'secondary':'')}</div><details><summary>Lock details</summary><p>${m.locked?`Locked by ${escape(m.lockedBy||'Not recorded')}<br>${escape(formatDate(m.lockedAt))}`:'This month is open for permitted plate edits.'}</p></details><p role="status" class="muted">${escape(state.monthMessages.get(m.id)||'')}</p></article>`).join('');
}
function subscribeMonths(){
  stopMonths?.();const epoch=state.epoch;$('#months-list').innerHTML='<div class="empty">Loading month locks…</div>';
  stopMonths=API.watchMonths(records=>{if(!state.authorized||epoch!==state.epoch)return;state.months=records;renderMonths();},error=>{if(epoch!==state.epoch)return;message(`Unable to load month locks: ${error.message}`,true);$('#months-list').innerHTML=button('Retry month locks','data-retry-months');});
}
function setTab(tab){state.tab=tab;document.querySelectorAll('[data-tab]').forEach(b=>{b.setAttribute('aria-current',b.dataset.tab===tab?'page':'false');});$('#people-panel').hidden=tab!=='people';$('#locks-panel').hidden=tab!=='locks';message();if(tab==='locks')subscribeMonths();else{stopMonths?.();stopMonths=null;} }
function readDraft(){return{person:$('#person-player').value,accessSections:[...document.querySelectorAll('#access-form [data-section]:checked')].map(el=>el.dataset.section)};}
function dirty(){return Boolean(state.editor)&&JSON.stringify(readDraft())!==state.editor.initial;}
function renderEditor(base){
  const known=protectedPerson(base);const isAdmin=String(base.email||'').toLowerCase()===API.ADMIN_EMAIL;
  $('#close-editor').disabled=false;
  $('#person-title').textContent=base.email||'Account access';
  $('#editor-body').innerHTML=`<section class="account-info"><h3>Account information</h3><span id="editor-account-state">${badge(base.status||'pending')}</span><dl><dt>Requested</dt><dd>${escape(formatDate(base.requestedAt))}</dd><dt>Last sign-in</dt><dd id="editor-last-login">${escape(formatDate(base.lastLoginAttemptAt))}</dd><dt>Last reviewed</dt><dd id="editor-reviewed-at">${escape(formatDate(base.reviewedAt))}</dd><dt>Reviewed by</dt><dd id="editor-reviewed-by">${escape(base.reviewedBy||'Not yet reviewed')}</dd></dl></section>${known?`<p class="inline-info"><strong>${isAdmin?'Administrator account':'Auto-approved family account'}</strong><br>This account is automatically approved by existing site rules. Some access is inherited; tools requiring explicit section grants still use the choices below. Denial is unavailable because the next sign-in would approve this account again.</p>`:''}${isAdmin?'<p class="inline-info"><strong>Project Billing</strong> is included for your administrator account only. It is not an assignable section.</p>':''}<fieldset><legend>Section access</legend><p class="muted">Choose what this person should be able to use.</p>${API.ACCESS_SECTIONS.map(s=>`<label class="access-choice"><input type="checkbox" data-section="${escape(s.id)}" ${(base.accessSections||[]).includes(s.id)?'checked':''}><span><strong>${escape(s.label)}</strong><small>${escape(s.description)}</small></span></label>`).join('')}</fieldset><fieldset><legend>Competition player</legend><p class="muted">This assignment applies only to the plate competition.</p><label class="field-label" for="person-player">Player assignment</label><select id="person-player" ${known?'disabled':''}>${[['','Unassigned'],['andy','Andy'],['savannah','Savannah']].map(([value,label])=>`<option value="${value}" ${(known||base.person||'')===value?'selected':''}>${label}</option>`).join('')}</select>${known?'<p class="muted">Player identity is assigned automatically for this account.</p>':''}</fieldset>`;
  renderEditorActions();$('#editor-status').textContent='';$('#editor-status').className='';$('#editor-conflict').hidden=true;$('#reload-person').hidden=true;
  state.editor.initial=JSON.stringify(readDraft());
}
function renderEditorActions(){
  const base=state.editor.base;const approved=base.status==='approved';
  $('#editor-actions').innerHTML=`${!approved?button('Approve & save','data-access-action="approve"',''):''}${button('Save access','data-access-action="save"',approved?'':'secondary')}${!protectedPerson(base)&&base.status!=='denied'?button(approved?'Revoke access':'Deny request','data-access-action="deny"','danger'):''}`;
}
function openPerson(id){
  const base=state.people.find(r=>r.id===id);if(!base){message('Account not found. Reload the accounts list.',true);return;}
  state.editor={base:{...base,accessSections:[...(base.accessSections||[])]},initial:'',returnId:id};renderEditor(state.editor.base);$('#person-editor').showModal();
}
function closeEditor(force=false){
  if(!force&&(state.busy||dirty()&&!confirm('Discard your unsaved access changes?')))return false;
  const id=state.editor?.returnId;state.editor=null;$('#person-editor').close();$('#editor-body').replaceChildren();$('#editor-actions').replaceChildren();$('#editor-status').textContent='';
  if(!force){const target=[...document.querySelectorAll('[data-person]')].find(el=>el.dataset.person===id);(target||$('#my-account')).focus();}
  return true;
}
function setBusy(busy){state.busy=busy;$('#access-form').querySelectorAll('input,button,select').forEach(el=>{el.disabled=busy||(el.id==='person-player'&&Boolean(state.editor&&protectedPerson(state.editor.base)));});$('#close-editor').disabled=busy;}
async function save(action){
  if(!state.editor||state.busy)return;
  const draft=readDraft();let allowEmpty=false;const base=state.editor.base;
  if(action==='approve'&&!draft.accessSections.length){if(!confirm('Approve this account without any sections? Approval alone does not grant access to tools that require assigned sections.'))return;allowEmpty=true;}
  if(action==='deny'&&!confirm(base.status==='approved'?'Revoke this account’s approval? Tools that require approval will stop accepting new requests from this account. Existing data will be kept.':'Deny this login request? The account will not receive approved access.'))return;
  const epoch=state.epoch;setBusy(true);$('#editor-status').textContent='Saving access…';$('#editor-status').className='';
  try{
    const patch=await API.saveAccess({base,draft,action,allowEmpty});
    if(!state.authorized||epoch!==state.epoch||!state.editor)return;
    state.people=state.people.map(r=>r.id===base.id?{...r,...patch}:r);
    state.editor.base={...state.editor.base,...patch};state.editor.initial=JSON.stringify(readDraft());
    renderPeople();renderEditorActions();$('#editor-account-state').innerHTML=badge(patch.status);$('#editor-conflict').hidden=true;$('#reload-person').hidden=true;
    $('#editor-status').textContent=action==='approve'?'Approved. Selected sections saved.':action==='deny'?'Account denied. Existing records have been kept.':'Section access saved. Approval status is unchanged.';
  }catch(error){if(epoch!==state.epoch)return;$('#editor-status').textContent=error.message+' Your choices are still here.';$('#editor-status').className='error';refreshConflict();}
  finally{if(epoch===state.epoch)setBusy(false);}
}
$('#access-form').addEventListener('submit',event=>{event.preventDefault();save('save');});
$('#people-search').addEventListener('input',event=>{state.search=event.target.value;state.page=0;renderPeople();});
$('#close-editor').onclick=()=>closeEditor();$('#person-editor').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
$('#my-account').onclick=()=>openPerson(API.auth.currentUser?.uid);
$('#reload-person').onclick=()=>{if(state.busy||dirty()&&!confirm('Reload the latest account and discard your unsaved choices?'))return;const current=state.people.find(r=>r.id===state.editor.base.id);if(current){state.editor.base={...current,accessSections:[...(current.accessSections||[])]};renderEditor(state.editor.base);$('#editor-status').textContent='Latest account loaded.';}};
document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b||!state.authorized)return;const d=b.dataset;
  if(d.tab)setTab(d.tab);
  if(d.filter){state.filter=d.filter;state.page=0;renderPeople();}
  if(d.page!==undefined){state.page=Number(d.page);renderPeople();}
  if(d.person)openPerson(d.person);
  if(d.accessAction)await save(d.accessAction);
  if(d.retryPeople!==undefined)subscribePeople();
  if(d.retryMonths!==undefined)subscribeMonths();
  if(d.month){
    const month=Model.monthRows(state.months).find(m=>m.id===d.month);if(!month||state.monthBusy.has(month.id))return;
    if(month.locked&&!confirm(`Unlock ${month.name} 2026? Approved players will be able to change plate entries again. Existing scores will not be reset.`))return;
    const epoch=state.epoch;state.monthBusy.add(month.id);state.monthMessages.set(month.id,'Saving…');renderMonths();
    try{await API.setMonthLock(month.id,!month.locked,month.locked);if(epoch!==state.epoch)return;state.monthMessages.set(month.id,`${month.name} ${month.locked?'unlocked':'locked'}. Scores preserved.`);}
    catch(error){if(epoch===state.epoch)state.monthMessages.set(month.id,error.message);}
    finally{if(epoch===state.epoch){state.monthBusy.delete(month.id);renderMonths();}}
  }
});
API.initHeaderAuth({onStateChange:({user,isAdmin})=>{
  if(user&&API.auth.currentUser?.uid!==user.uid)return;
  state.epoch++;state.authorized=false;stopPeople?.();stopMonths?.();stopPeople=null;stopMonths=null;closeEditor(true);state.busy=false;
  state.people=[];state.months=[];state.filter='all';state.search='';state.page=0;state.initialFilter=false;state.monthMessages.clear();state.monthBusy.clear();
  $('#people-search').value='';$('#people-list').replaceChildren();$('#months-list').replaceChildren();$('#people-filters').replaceChildren();$('#people-summary').textContent='';$('#people-pagination').replaceChildren();$('#pending-count').textContent='0';message();
  $('#admin-app').hidden=true;$('#admin-gate').hidden=false;
  if(!user){$('#gate-message').textContent='Sign in above with your administrator account to manage SavemHQ.';return;}
  if(!isAdmin||user.email?.toLowerCase()!==API.ADMIN_EMAIL){$('#gate-message').textContent='This workspace is only available to the SavemHQ administrator.';return;}
  state.authorized=true;$('#admin-gate').hidden=true;$('#admin-app').hidden=false;setTab('people');subscribePeople();
}});
window.addEventListener('beforeunload',event=>{if(state.editor&&dirty()){event.preventDefault();event.returnValue='';}});
