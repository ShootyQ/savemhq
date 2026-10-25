import { imageBlob } from './api.js';
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
let logoUrl;
export async function preview(record, payments = []) {
  const d = window.BusinessFinance.documentView(record);
  if (logoUrl) URL.revokeObjectURL(logoUrl);
  logoUrl = null;
  let logoWarning = '';
  if (d.business.logoPath) { try { logoUrl = URL.createObjectURL(await imageBlob(d.business.logoPath)); } catch { logoWarning = 'Logo unavailable. Close and reopen the preview to retry.'; } }
  const balance = window.BusinessFinance.paymentsBalance(d.totalCents, payments);
  document.querySelector('#document').innerHTML = `
    ${record.status === 'void' ? '<p class="void-document">VOID · Superseded invoice — do not pay</p>' : ''}<header class="document-head"><div>${logoUrl ? `<img src="${logoUrl}" alt="${escape(d.business.name)} logo">` : ''}<h2>${escape(d.business.name)}</h2><div class="preserve">${escape(d.business.contact)}</div></div><div class="document-meta"><h1>${escape(d.kind)}</h1><strong>${escape(d.number)}</strong><br>${escape(d.date)}${d.dueDate ? `<br><small>${d.kind === 'Invoice' ? 'Due' : 'Valid through'} ${escape(d.dueDate)}</small>` : ''}</div></header>
    <div class="document-party"><section><p class="eyebrow">Prepared for</p><strong>${escape(d.client.name)}</strong><div class="preserve">${escape(d.client.address)}</div><div>${escape(d.client.email)}</div></section><section><p class="eyebrow">Project</p><strong>${escape(d.title)}</strong><div class="preserve">${escape(d.location)}</div></section></div>
    <table><thead><tr><th>Scope of work</th><th class="money">Amount</th></tr></thead><tbody>${d.lines.map(l => `<tr><td>${l.group ? `<small class="eyebrow">${escape(l.group)}</small><br>` : ''}<span class="preserve">${escape(l.description)}</span></td><td class="money">${money(l.priceCents)}</td></tr>`).join('')}</tbody></table>
    <div class="document-totals"><div><span>Subtotal</span><span>${money(d.subtotalCents)}</span></div>${d.discountCents ? `<div><span>Discount</span><span>−${money(d.discountCents)}</span></div>` : ''}<div><span>Tax</span><span>${money(d.taxCents)}</span></div><div class="grand"><strong>Total</strong><strong>${money(d.totalCents)}</strong></div>${d.kind === 'Invoice' ? `<div><span>Payments received</span><span>${money(balance.paidCents)}</span></div><div class="grand"><strong>Balance due</strong><strong>${money(balance.balanceCents)}</strong></div>` : ''}</div>
    ${d.kind === 'Invoice' && payments.some(p => !p.voided) ? `<section><h3>Payment history</h3>${payments.filter(p => !p.voided).map(p => `<p>${escape(p.date)} · ${escape(p.method)} · ${money(p.amountCents)}</p>`).join('')}</section>` : ''}
    <section class="document-terms">${d.terms ? `<h3>Terms &amp; details</h3><p class="preserve">${escape(d.terms)}</p>` : ''}${d.paymentInstructions ? `<h3>Payment instructions</h3><p class="preserve">${escape(d.paymentInstructions)}</p>` : ''}</section><footer class="document-footer">${escape(d.business.name)} · ${escape(d.number)}</footer>`;
  const dialog = document.querySelector('#preview');
  dialog.querySelector('.preview-actions span').textContent = logoWarning || 'Client document · Internal details excluded';
  dialog.showModal();
}
