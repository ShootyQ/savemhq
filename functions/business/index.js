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
