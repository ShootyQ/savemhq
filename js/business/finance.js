/* Shared deterministic finance engine. Served to the browser via js/business/finance.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BusinessFinance = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const integer = (n, name = 'Amount', min = 0) => {
    if (!Number.isSafeInteger(n) || n < min || Math.abs(n) > 10000000000) throw new Error(`${name} must be a valid integer`);
    return n;
  };
  const rate = n => { if (!Number.isFinite(n) || n < 0 || n > 1000) throw new Error('Invalid percentage'); return n; };
  const sum = values => values.reduce((a, b) => a + b, 0);
  const labor = (minutes, hourlyCents) => integer(Math.round(integer(minutes, 'Minutes') * integer(hourlyCents, 'Hourly cost') / 60), 'Labor cost');
  function line(raw) {
    const minutes = integer(raw.minutes ?? 0, 'Minutes');
    const laborCents = labor(minutes, raw.costRateCents ?? 0);
    const materialQuantity = raw.materialQuantity == null ? 1 : raw.materialQuantity;
    if (!Number.isFinite(materialQuantity) || materialQuantity < 0 || materialQuantity > 1000000) throw new Error('Invalid material quantity');
    const materialUnitCostCents = raw.materialUnitCostCents == null ? integer(raw.materialCents ?? 0) : integer(raw.materialUnitCostCents);
    const materialCents = integer(Math.round(materialQuantity * materialUnitCostCents));
    const subcontractCents = integer(raw.subcontractCents ?? 0);
    const travelCents = integer(raw.travelCents ?? 0);
    const otherCents = integer(raw.otherCents ?? 0);
    const directCents = integer(laborCents + materialCents + subcontractCents + travelCents + otherCents, 'Direct cost');
    const priceCents = integer(raw.priceCents == null ? Math.round(directCents * (1 + rate(raw.markupPercent ?? 0) / 100)) : raw.priceCents, 'Selling price');
    return { group: String(raw.group || '').slice(0, 160), description: String(raw.description || '').slice(0, 4000), minutes, costRateCents: raw.costRateCents ?? 0, laborCents, materialQuantity, materialUnitCostCents, materialCents, subcontractCents, travelCents, otherCents, directCents, priceCents, taxable: raw.taxable === true };
  }
  // Largest-remainder allocation keeps discounts exact down to the last cent.
  function allocate(total, weights) {
    integer(total); weights.forEach(w => integer(w));
    const base = sum(weights);
    if (!base) { if (total) throw new Error('Cannot allocate against zero'); return weights.map(() => 0); }
    const values = weights.map(w => Number(BigInt(total) * BigInt(w) / BigInt(base)));
    const order = weights.map((w, i) => ({ i, remainder: BigInt(total) * BigInt(w) % BigInt(base) })).sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
    const remainder = total - sum(values);
    for (let i = 0; i < remainder; i++) values[order[i].i]++;
    return values;
  }
  function estimate(raw) {
    if (!Array.isArray(raw.lines) || !raw.lines.length || raw.lines.length > 100) throw new Error('Add 1–100 scope items');
    const lines = raw.lines.map(line);
    const subtotalCents = integer(sum(lines.map(l => l.priceCents)), 'Subtotal');
    const discountCents = integer(raw.discountCents ?? 0);
    if (discountCents > subtotalCents) throw new Error('Discount exceeds selling price');
    const discounts = allocate(discountCents, lines.map(l => l.priceCents));
    const taxableCents = sum(lines.map((l, i) => l.taxable ? l.priceCents - discounts[i] : 0));
    const taxCents = Math.round(taxableCents * rate(raw.taxPercent ?? 0) / 100);
    const directCents = sum(lines.map(l => l.directCents));
    const overheadCents = Math.round(directCents * rate(raw.overheadPercent ?? 0) / 100);
    const revenueCents = subtotalCents - discountCents;
    const costCents = directCents + overheadCents;
    const profitCents = revenueCents - costCents;
    return { lines, subtotalCents, discountCents, taxableCents, taxCents, revenueCents, totalCents: revenueCents + taxCents, directCents, overheadCents, costCents, profitCents, minutes: sum(lines.map(l => l.minutes)), marginPercent: revenueCents ? profitCents / revenueCents * 100 : 0, markupPercent: costCents ? profitCents / costCents * 100 : 0, overheadPercent: raw.overheadPercent ?? 0, taxPercent: raw.taxPercent ?? 0 };
  }
  function expense(raw) {
    const amountCents = integer(raw.amountCents);
    const allocations = raw.allocations || [];
    allocations.forEach(a => integer(a.amountCents));
    if (allocations.length && sum(allocations.map(a => a.amountCents)) !== amountCents) throw new Error('Allocations must equal the expense total');
    return { ...raw, amountCents, allocations };
  }
  function paymentsBalance(totalCents, payments) {
    const paidCents = sum(payments.filter(p => !p.voided).map(p => integer(p.amountCents)));
    return { paidCents, balanceCents: totalCents - paidCents, status: paidCents >= totalCents ? 'paid' : paidCents ? 'part-paid' : 'unpaid' };
  }
  function report(job, times, expenses, changes, payments) {
    const approved = changes.filter(c => c.jobId === job.id && c.status === 'approved');
    expenses = expenses.filter(e => !e.voided);
    const originalCategories = { labor: sum(job.baseline.lines.map(l => l.laborCents)), materials: sum(job.baseline.lines.map(l => l.materialCents)), subcontractors: sum(job.baseline.lines.map(l => l.subcontractCents)), travel: sum(job.baseline.lines.map(l => l.travelCents)), other: sum(job.baseline.lines.map(l => l.otherCents)) };
    const revisedCategories = { ...originalCategories };
    approved.forEach(c => { const key = c.costCategory || 'other'; revisedCategories[key] = (revisedCategories[key] || 0) + c.costCents; });
    const revisedDirectCents = sum(Object.values(revisedCategories));
    const revisedCostCents = revisedDirectCents + Math.round(revisedDirectCents * (job.baseline.overheadPercent || 0) / 100);
    const jobTimes = times.filter(t => t.jobId === job.id && !t.voided);
    const categories = { labor: sum(jobTimes.filter(t => t.kind !== 'travel').map(t => labor(t.minutes, t.costRateCents))), travel: sum(jobTimes.filter(t => t.kind === 'travel').map(t => labor(t.minutes, t.costRateCents) + (t.mileageCents || 0))) };
    expenses.forEach(e => (e.allocations || []).filter(a => a.jobId === job.id).forEach(a => { categories[e.category] = (categories[e.category] || 0) + a.amountCents; }));
    const directCents = sum(Object.values(categories));
    const overheadCents = Math.round(directCents * (job.baseline.overheadPercent || 0) / 100);
    const changeRevenueCents = sum(approved.map(c => c.priceCents));
    const revenueCents = job.baseline.revenueCents + changeRevenueCents;
    return { categories, originalCategories, revisedCategories, originalRevenueCents: job.baseline.revenueCents, changeRevenueCents, revenueCents, originalCostCents: job.baseline.costCents, revisedCostCents, directCents, overheadCents, actualCostCents: directCents + overheadCents, profitCents: revenueCents - directCents - overheadCents, estimatedMinutes: job.baseline.minutes, revisedMinutes: job.baseline.minutes + sum(approved.map(c => c.minutes)), actualMinutes: sum(jobTimes.map(t => t.minutes)), collectedCents: sum(payments.filter(p => p.jobId === job.id && !p.voided).map(p => p.amountCents)) };
  }
  // This is deliberately a whitelist, never a spread of an internal record.
  function documentView(record) {
    const d = record.document;
    if (!d) throw new Error('Issue this document before printing');
    return { kind: d.kind, number: d.number, date: d.date, dueDate: d.dueDate, business: { name: d.business.name, contact: d.business.contact, logoPath: d.business.logoPath }, client: { name: d.client.name, email: d.client.email, address: d.client.address }, title: d.title, location: d.location, lines: d.lines.map(l => ({ group: l.group, description: l.description, priceCents: l.priceCents })), subtotalCents: d.subtotalCents, discountCents: d.discountCents, taxCents: d.taxCents, totalCents: d.totalCents, terms: d.terms, paymentInstructions: d.paymentInstructions };
  }
  return { integer, rate, sum, labor, line, allocate, estimate, expense, paymentsBalance, report, documentView };
});
