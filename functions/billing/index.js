'use strict';
const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { createService } = require('../business/service');
const service = createService(admin.firestore(), undefined, { mode: 'billing' });
exports.projectBillingCommand = onCall({ maxInstances: 5 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue');
  if (request.auth.token.email !== 'andrewpcarlson85@gmail.com') throw new HttpsError('permission-denied', 'This billing portal is for the administrator only');
  try { return await service(request.auth.uid, request.data || {}); }
  catch (error) {
    if (/approval/.test(error.message)) throw new HttpsError('permission-denied', error.message);
    if (error.code) { console.error('Project billing command failed', { code: error.code }); throw new HttpsError('internal', 'Unable to save. Retry your request.'); }
    throw new HttpsError('failed-precondition', error.message || 'Unable to save');
  }
});
