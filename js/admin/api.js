import { collection, doc, onSnapshot, runTransaction, serverTimestamp, deleteField } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { auth, db, ADMIN_EMAIL, ACCESS_SECTIONS, getKnownUserProfile, initHeaderAuth } from '../auth-shared.js';
const Model=window.AdminModel;
const year='2026';
function requireAdmin(){const user=auth.currentUser;if(user?.email?.toLowerCase()!==ADMIN_EMAIL)throw new Error('Sign in with the administrator account to continue.');return user;}
export const watchPeople=(next,error)=>onSnapshot(collection(db,'loginApprovals'),snapshot=>next(snapshot.docs.map(d=>({...d.data(),id:d.id}))),error);
export const watchMonths=(next,error)=>onSnapshot(collection(db,'competitions',year,'months'),snapshot=>next(snapshot.docs.map(d=>({...d.data(),id:d.id}))),error);
export async function saveAccess({base,draft,action,allowEmpty}){
  const user=requireAdmin();const ref=doc(db,'loginApprovals',base.id);
  return runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(ref);if(!snapshot.exists())throw new Error('This account no longer exists.');
    if(auth.currentUser?.uid!==user.uid)throw new Error('Your sign-in changed. Reload before saving.');
    requireAdmin();
    const current=snapshot.data();
    const patch=Model.approvalChange({current,base,draft,action,allowEmpty,allowedSections:ACCESS_SECTIONS.map(s=>s.id),protectedPerson:getKnownUserProfile(current.email)?.autoApprove?getKnownUserProfile(current.email).person:''});
    transaction.update(ref,{...patch,reviewedAt:serverTimestamp(),reviewedBy:user.email});
    return {...patch,reviewedBy:user.email};
  });
}
export async function setMonthLock(id,locked,expected){
  const user=requireAdmin();if(!Model.monthRows([]).some(m=>m.id===id))throw new Error('Unknown competition month');
  const ref=doc(db,'competitions',year,'months',id);
  await runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(ref);const record=snapshot.data()||{};
    if(auth.currentUser?.uid!==user.uid)throw new Error('Your sign-in changed. Reload before saving.');requireAdmin();
    if((record.locked===true)!==expected)throw new Error('This month’s lock changed. Review the latest status and try again.');
    // Deliberately never touch state arrays, scores, or manualCounts.
    transaction.set(ref,{locked,lockedAt:locked?serverTimestamp():deleteField(),lockedBy:locked?user.email:deleteField(),updatedAt:serverTimestamp()},{merge:true});
  });
}
export { auth, ADMIN_EMAIL, ACCESS_SECTIONS, getKnownUserProfile, initHeaderAuth };
