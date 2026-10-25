import { auth, db, ADMIN_EMAIL, ensureApprovalRecord } from '../auth-shared.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { collection, doc, getDoc, getDocs, query, orderBy, limit, startAfter } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
const invoke = httpsCallable(getFunctions(getApp(), 'us-central1'), 'projectBillingCommand');
const root = () => `projectBilling/${auth.currentUser.uid}`;
export async function session(user) { return user?.email === ADMIN_EMAIL && (await ensureApprovalRecord(user)).status === 'approved'; }
export const command = async input => (await invoke(input)).data;
export async function record(type, id) { const snap = await getDoc(doc(db, root(), type, id)); return snap.exists() ? { ...snap.data(), id: snap.id } : null; }
export async function list(type) {
  const records = []; let cursor;
  do {
    const constraints = [orderBy('__name__'), limit(100)]; if(cursor) constraints.push(startAfter(cursor));
    const page = await getDocs(query(collection(db, root(), type), ...constraints));
    records.push(...page.docs.map(s => ({ ...s.data(), id:s.id })));
    cursor = page.size === 100 ? page.docs.at(-1) : null;
  } while(cursor);
  return records;
}
export { auth };
