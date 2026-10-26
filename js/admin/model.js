(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AdminModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const sections = record => [...new Set(Array.isArray(record.accessSections)?record.accessSections:[])].sort();
  const managed = record => JSON.stringify({status:record.status||'pending',person:record.person||'',accessSections:sections(record)});
  function approvalChange({current,base,draft,action,allowedSections,protectedPerson='',allowEmpty=false}){
    if(managed(current)!==managed(base))throw new Error('This account’s access changed while you were editing. Reload the latest account before saving.');
    if(!['save','approve','deny'].includes(action))throw new Error('Unknown account action');
    if(action==='deny'&&protectedPerson)throw new Error('This family account is automatically approved and cannot be denied here.');
    const accessSections=[...new Set(draft.accessSections||[])].filter(id=>allowedSections.includes(id));
    if(action==='approve'&&!accessSections.length&&!allowEmpty)throw new Error('Confirm approval without any assigned sections.');
    const person=protectedPerson||draft.person||'';
    if(!['','andy','savannah'].includes(person))throw new Error('Choose a valid competition player');
    return{person:person||null,personLabel:person==='andy'?'Andy':person==='savannah'?'Savannah':null,accessSections,status:action==='approve'?'approved':action==='deny'?'denied':current.status||'pending'};
  }
  function selectPeople(records,{filter='all',search=''}={}){
    const needle=search.trim().toLowerCase();
    return [...records].filter(r=>(filter==='all'||(r.status||'pending')===filter)&&(!needle||`${r.email||''} ${r.person||''} ${r.personLabel||''}`.toLowerCase().includes(needle))).sort((a,b)=>{
      if((a.status||'pending')==='pending'&&(b.status||'pending')!=='pending')return-1;
      if((b.status||'pending')==='pending'&&(a.status||'pending')!=='pending')return 1;
      if((a.status||'pending')==='pending'&&(b.status||'pending')==='pending')return stamp(a.requestedAt)-stamp(b.requestedAt);
      return String(a.email||'').localeCompare(String(b.email||''));
    });
  }
  function stamp(value){if(!value)return 0;const date=value.toDate?.()||new Date(value);return date.getTime()||0;}
  function monthRows(records){const map=new Map(records.map(r=>[r.id,r]));return months.map((name,index)=>{const id=name.toLowerCase();const r=map.get(id)||{};const manual=Number.isFinite(r.manualCounts?.andy)&&Number.isFinite(r.manualCounts?.savannah);return{id,name,locked:r.locked===true,andy:manual?r.manualCounts.andy:(r.andyStates||[]).length,savannah:manual?r.manualCounts.savannah:(r.savannahStates||[]).length,manual,lockedAt:r.lockedAt||null,lockedBy:r.lockedBy||'',order:index};});}
  return{managed,approvalChange,selectPeople,monthRows,stamp};
});
