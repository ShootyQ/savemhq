import { compressImage } from './images.js';
import { auth, db, ensureApprovalRecord } from '../auth-shared.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { collection, doc, getDoc, getDocs, query, orderBy, limit, startAfter, onSnapshot, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getStorage, ref, uploadBytesResumable, getBlob, connectStorageEmulator } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';
import { connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
const functions = getFunctions(getApp(), 'us-central1');
const storage = getStorage(getApp());
// Explicit local-only opt-in; production never connects to an emulator.
if (['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('emulators') === '1') {
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
const invoke = httpsCallable(functions, 'businessCommand');
const root = () => `businesses/${auth.currentUser.uid}`;
export async function session(user) {
  if (!user) return false;
  const approval = await ensureApprovalRecord(user);
  return approval.status === 'approved' && approval.accessSections.includes('business');
}
export const command = async input => (await invoke(input)).data;
export async function record(type, key) {
  const snap = await getDoc(doc(db, root(), type, key));
  return snap.exists() ? { ...snap.data(), id: snap.id } : null;
}
// Firestore pages are bounded; historical records are rendered in client pages too.
export async function list(type) {
  const records = []; let cursor;
  do {
    const constraints = [orderBy('__name__'), limit(100)];
    if (cursor) constraints.push(startAfter(cursor));
    const page = await getDocs(query(collection(db, root(), type), ...constraints));
    records.push(...page.docs.map(s => ({ ...s.data(), id: s.id })));
    cursor = page.size === 100 ? page.docs.at(-1) : null;
  } while (cursor);
  return records;
}
export async function upload(file, folder, progress) {
  if (!file) return '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use JPEG, PNG, or WebP. Convert HEIC with your phone’s “Most compatible” export option.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image no larger than 10 MB.');
  progress?.('compressing');
  file = await compressImage(file, folder);
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  const path = `${root()}/${folder}/${crypto.randomUUID()}.${extension}`;
  const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type });
  await new Promise((resolve, reject) => task.on('state_changed', s => progress?.(Math.round(s.bytesTransferred / s.totalBytes * 100)), reject, resolve));
  return path;
}
export const imageBlob = path => getBlob(ref(storage, path), 10 * 1024 * 1024);
export { auth };

export const watchAccess = (uid, callback) => onSnapshot(doc(db, 'loginApprovals', uid), snap => {
  const approval = snap.data();
  callback(approval?.status === 'approved' && Array.isArray(approval.accessSections) && approval.accessSections.includes('business'));
}, () => callback(false));

export const syncDesk = async () => (await httpsCallable(functions, 'businessSyncDesk')({})).data;
