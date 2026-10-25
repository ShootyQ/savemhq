'use strict';
// Provider boundary: no credentials or live processing until separately configured.
const providers = Object.freeze({ manual: { enabled: true }, stripe: { enabled: false } });
function paymentProvider(name = 'manual') {
  if (!providers[name]?.enabled) throw new Error('Online payments are not enabled');
  return { name, externalPaymentId: null };
}
module.exports = { providers, paymentProvider };
