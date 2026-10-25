'use strict';
const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { createService } = require('./service');
const service = createService(admin.firestore());
exports.businessCommand = onCall({ maxInstances: 10 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue');
  try { return await service(request.auth.uid, request.data || {}); }
  catch (error) {
    if (/approval/.test(error.message)) throw new HttpsError('permission-denied', error.message);
    if (error.code && !['invalid-argument', 'failed-precondition'].includes(error.code)) {
      console.error('Business command failed', { code: error.code });
      throw new HttpsError('internal', 'Unable to save. Retry your request.');
    }
    throw new HttpsError('failed-precondition', error.message || 'Unable to save');
  }
});

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { createDeskSync, TYPES } = require('./desk');
const deskSync = createDeskSync(admin.firestore(), date => admin.firestore.Timestamp.fromDate(date));
exports.businessDeskSync = onDocumentWritten({ document: 'businesses/{ownerUid}/{collection}/{recordId}', retry: true, maxInstances: 5, timeoutSeconds: 540 }, async event => {
  const { ownerUid, collection, recordId } = event.params;
  if (collection === 'settings' && recordId === 'profile') return deskSync.all(ownerUid);
  if (!TYPES.includes(collection) && collection !== 'payments') return;
  return deskSync.changed(ownerUid, collection, recordId, event.data?.before.data() || {});
});
exports.businessDeskAccessSync = onDocumentWritten({ document: 'loginApprovals/{ownerUid}', retry: true, maxInstances: 5, timeoutSeconds: 540 }, async event => {
  const before=event.data?.before.data();const after=event.data?.after.data();
  if(JSON.stringify([before?.status,before?.accessSections])===JSON.stringify([after?.status,after?.accessSections]))return;
  if(!before?.accessSections?.includes('business') && !after?.accessSections?.includes('business'))return;
  return deskSync.all(event.params.ownerUid);
});
exports.businessSyncDesk = onCall({ maxInstances: 5, timeoutSeconds: 540 }, async request => {
  if(!request.auth)throw new HttpsError('unauthenticated','Sign in to continue');
  const approval=(await admin.firestore().collection('loginApprovals').doc(request.auth.uid).get()).data();
  if(approval?.status!=='approved'||!approval.accessSections?.includes('business'))throw new HttpsError('permission-denied','Handyman Business approval is required');
  if(!approval.accessSections.includes('desk') && request.auth.token.email!=='andrewpcarlson85@gmail.com')throw new HttpsError('failed-precondition','Enable The Desk for this account before syncing tasks');
  return deskSync.all(request.auth.uid);
});
