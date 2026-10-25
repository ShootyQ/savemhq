'use strict';
const F = require('./finance');
const { paymentProvider } = require('./payments');
const crypto = require('node:crypto');
const COLLECTIONS = new Set(['clients', 'estimates', 'jobs', 'visits', 'workers', 'timeEntries', 'expenses', 'changes', 'invoices', 'payments', 'activity', 'templates', 'photos', 'opportunities']);
const fail = message => { throw new Error(message); };
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const id = value => /^[A-Za-z0-9_-]{1,100}$/.test(String(value || '')) ? value : fail('Invalid record identifier');
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : fail('Choose a valid date');
const amount = (value, signed = false) => F.integer(value ?? 0, 'Amount', signed ? -10000000000 : 0);
const image = (value, uid) => !value ? '' : new RegExp(`^businesses/${uid}/[A-Za-z0-9_/-]+\\.(jpg|jpeg|png|webp)$`).test(value) ? value : fail('Invalid image path');
const defaultSettings = () => ({ name: '', contact: '', timezone: 'America/Chicago', costRateCents: 0, billRateCents: 0, mileageRateCents: 0, overheadPercent: 0, taxPercent: 0, markupPercent: 0, terms: '', paymentInstructions: '', logoPath: '', categories: ['materials', 'tools', 'fuel', 'travel', 'subcontractors', 'other'], estimatePrefix: 'EST', invoicePrefix: 'INV', nextEstimate: 1, nextInvoice: 1 });
function sanitizeSettings(p, uid, existing) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: p.timezone || 'America/Chicago' }); } catch { fail('Invalid timezone'); }
  return { ...defaultSettings(), ...existing, deskSyncEnabled: p.deskSyncEnabled !== false, name: text(p.name, 120), contact: text(p.contact, 1000), timezone: text(p.timezone || 'America/Chicago', 80), costRateCents: amount(p.costRateCents), billRateCents: amount(p.billRateCents), mileageRateCents: amount(p.mileageRateCents), overheadPercent: F.rate(p.overheadPercent || 0), taxPercent: F.rate(p.taxPercent || 0), markupPercent: F.rate(p.markupPercent || 0), terms: text(p.terms), paymentInstructions: text(p.paymentInstructions), logoPath: image(p.logoPath, uid), categories: [...new Set([...defaultSettings().categories, ...(Array.isArray(p.categories) ? p.categories : []).map(c => text(c, 60)).filter(Boolean)])].slice(0, 40), estimatePrefix: text(p.estimatePrefix || 'EST', 12).replace(/[^A-Za-z0-9-]/g, ''), invoicePrefix: text(p.invoicePrefix || 'INV', 12).replace(/[^A-Za-z0-9-]/g, '') };
}
const overlaps = (a, b) => a.date === b.date && a.start < b.end && b.start < a.end && a.workerIds.some(w => b.workerIds.includes(w));
function createService(db, clock = () => new Date().toISOString()) {
  return async function command(uid, input) {
    id(uid); id(input.requestId);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const root = db.collection('businesses').doc(uid);
    const now = clock();
    return db.runTransaction(async tx => {
      // Approval is checked inside the transaction so revocation participates in retries.
      const approval = await tx.get(db.collection('loginApprovals').doc(uid));
      const access = approval.data();
      if (access?.status !== 'approved' || !access.accessSections?.includes('business')) fail('Handyman Business approval is required');
      const requestRef = root.collection('requests').doc(input.requestId);
      const prior = await tx.get(requestRef);
      if (prior.exists) { if (prior.data().fingerprint !== fingerprint) fail('Request identifier already used'); return prior.data().result; }
      const settingsRef = root.collection('settings').doc('profile');
      const settingsSnap = await tx.get(settingsRef);
      const settings = { ...defaultSettings(), ...settingsSnap.data() };
      const writes = [];
      const put = (ref, data) => writes.push(() => tx.set(ref, data));
      const get = async (collection, key, optional = false) => {
        const ref = root.collection(collection).doc(id(key)); const snap = await tx.get(ref);
        if (!snap.exists && !optional) fail(`${collection} record not found`);
        return { ref, data: snap.exists ? { ...snap.data(), id: snap.id } : null };
      };
      const event = (action, clientId, jobId, recordId) => put(root.collection('activity').doc(input.requestId), { action, clientId: clientId || '', jobId: jobId || '', recordId: recordId || '', createdAt: now });
      let result = { ok: true };
      const p = input.payload || {};
      if (input.action === 'settings') {
        const saved = sanitizeSettings(p, uid, settings);
        if (!saved.name) fail('Enter your business name');
        put(settingsRef, { ...saved, updatedAt: now });
      } else if (input.action === 'save') {
        const collection = input.collection;
        if (!COLLECTIONS.has(collection) || ['invoices', 'payments', 'activity'].includes(collection)) fail('Unsupported collection');
        const key = input.id ? id(input.id) : input.requestId;
        const current = await get(collection, key, true);
        const old = current.data;
        if (old && (p.version ?? 0) !== (old.version || 0)) fail('This record changed. Reload before saving your edits.');
        let data;
        const link = async (type, key) => (await get(type, key)).data;
        switch (collection) {
          case 'clients':
            if (!text(p.name, 120)) fail('Client name is required');
            data = { name: text(p.name, 120), email: text(p.email, 200), phone: text(p.phone, 80), address: text(p.address, 1000), locations: text(p.locations, 2000), notes: text(p.notes), followUpDate: p.followUpDate ? date(p.followUpDate) : '', archived: p.archived === true }; break;
          case 'workers':
            if (!text(p.name, 120)) fail('Helper name is required');
            data = { name: text(p.name, 120), costRateCents: amount(p.costRateCents), billRateCents: amount(p.billRateCents), archived: p.archived === true }; break;
          case 'estimates': {
            if (old && old.status !== 'draft') fail('Issued estimates are immutable. Create a revision.');
            await link('clients', p.clientId);
            const totals = F.estimate(p);
            if (totals.lines.some(l => !l.description)) fail('Every scope item needs a description');
            data = { clientId: id(p.clientId), title: text(p.title, 160), location: text(p.location, 1000), lines: totals.lines, discountCents: totals.discountCents, overheadPercent: totals.overheadPercent, taxPercent: totals.taxPercent, terms: text(p.terms ?? settings.terms), notes: text(p.notes), expiresDate: p.expiresDate ? date(p.expiresDate) : '', status: 'draft', supersedesId: p.supersedesId ? id(p.supersedesId) : '', totals };
            if (!data.title) fail('Job title is required');
            break;
          }
          case 'templates': {
            const item = F.line(p);
            if (!item.description) fail('Template description required');
            data = { ...item, archived: p.archived === true }; break;
          }
          case 'jobs': {
            if (!old) fail('Create jobs from accepted estimates');
            if (!['scheduled', 'in-progress', 'on-hold', 'completed', 'cancelled'].includes(p.status)) fail('Invalid job status');
            data = { ...old, status: p.status, notes: text(p.notes), lessons: text(p.lessons) };
            if (data.status !== old.status) event(`Job ${data.status}`, old.clientId, key, key);
            break;
          }
          case 'visits': {
            const job = await link('jobs', p.jobId);
            const workerIds = [...new Set(Array.isArray(p.workerIds) ? p.workerIds : [])];
            for (const worker of workerIds) { if (worker !== 'owner') await link('workers', worker); }
            if (!workerIds.length) workerIds.push('owner');
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end) || p.start >= p.end) fail('End must be after start on the same day');
            data = { jobId: job.id, clientId: job.clientId, date: date(p.date), start: p.start, end: p.end, workerIds, notes: text(p.notes) };
            const visits = await tx.get(root.collection('visits').where('date', '==', data.date));
            const conflict = visits.docs.some(s => s.id !== key && overlaps(data, s.data()));
            if (conflict && p.overrideConflict !== true) fail('Schedule overlaps an assigned helper. Confirm the overlap override to save.');
            data.overrideConflict = conflict; break;
          }
          case 'timeEntries': {
            if (old) fail('Time entries retain their rate snapshot. Void and create a replacement.');
            const job = await link('jobs', p.jobId);
            const workerId = p.workerId || 'owner';
            const worker = workerId === 'owner' ? null : await link('workers', workerId);
            const minutes = F.integer(p.minutes, 'Minutes');
            if (!minutes || minutes > 10080) fail('Enter a duration of 1–10080 minutes');
            if (minutes > 720 && p.confirmLong !== true) fail('Confirm this session exceeds 12 hours');
            const kind = p.kind === 'travel' ? 'travel' : 'work';
            const miles = Number(p.miles || 0);
            if (!Number.isFinite(miles) || miles < 0 || miles > 10000) fail('Invalid mileage');
            data = { jobId: job.id, clientId: job.clientId, workerId, date: date(p.date), minutes, kind, costRateCents: worker ? worker.costRateCents : settings.costRateCents, billRateCents: worker ? worker.billRateCents : settings.billRateCents, miles: kind === 'travel' ? miles : 0, mileageCents: kind === 'travel' ? Math.round(miles * settings.mileageRateCents) : 0, notes: text(p.notes), voided: false }; break;
          }
          case 'expenses': {
            if (old?.voided) fail('Voided expense cannot be edited');
            const allocations = [];
            if ((p.allocations || []).length > 100) fail('Too many allocations');
            for (const a of p.allocations || []) {
              const job = a.jobId ? await link('jobs', a.jobId) : null;
              const client = !job && a.clientId ? await link('clients', a.clientId) : null;
              allocations.push({ jobId: job?.id || '', clientId: job?.clientId || client?.id || '', amountCents: amount(a.amountCents) });
            }
            if (!settings.categories.includes(p.category)) fail('Choose a configured expense category');
            data = F.expense({ merchant: text(p.merchant, 160), date: date(p.date), amountCents: amount(p.amountCents), category: p.category, notes: text(p.notes), receiptPath: image(p.receiptPath, uid), allocations, voided: false });
            break;
          }
          case 'changes': {
            if (old?.status === 'approved') fail('Approved changes are immutable');
            const job = await link('jobs', p.jobId);
            data = { jobId: job.id, clientId: job.clientId, description: text(p.description), priceCents: amount(p.priceCents, true), costCents: amount(p.costCents, true), minutes: F.integer(p.minutes || 0, 'Minutes', -10080), costCategory: ['labor', 'materials', 'subcontractors', 'travel', 'other'].includes(p.costCategory) ? p.costCategory : 'other', taxable: p.taxable === true, status: 'draft' };
            if (!data.description) fail('Change scope is required');
            break;
          }
          case 'photos': {
            const job = await link('jobs', p.jobId);
            if (!['before', 'progress', 'after'].includes(p.kind)) fail('Choose photo type');
            data = { jobId: job.id, clientId: job.clientId, kind: p.kind, caption: text(p.caption), path: image(p.path, uid) };
            if (!data.path) fail('Choose a photo'); break;
          }
          case 'opportunities':
            await link('clients', p.clientId);
            data = { clientId: id(p.clientId), title: text(p.title, 160), notes: text(p.notes), followUpDate: p.followUpDate ? date(p.followUpDate) : '', archived: p.archived === true };
            if (!data.title) fail('Opportunity title required'); break;
          default: fail('Unsupported record');
        }
        put(current.ref, { ...data, version: (old?.version || 0) + 1, createdAt: old?.createdAt || now, updatedAt: now });
        result.id = key;
      } else if (input.action === 'timer') {
        const ref = root.collection('settings').doc('timer'); const snap = await tx.get(ref);
        const timer = snap.data();
        if (p.stop) {
          if (!timer?.startedAt) fail('No active timer');
          const minutes = Math.max(1, Math.round((Date.parse(now) - Date.parse(timer.startedAt)) / 60000));
          if (minutes > 10080) fail('Timer exceeds seven days. Cancel it and enter time manually.');
          if (minutes > 720 && !p.confirmLong) fail('Confirm this session exceeds 12 hours');
          const job = (await get('jobs', timer.jobId)).data;
          put(root.collection('timeEntries').doc(input.requestId), { ...timer, clientId: job.clientId, minutes, date: timer.date, miles: 0, mileageCents: 0, voided: false, version: 1, createdAt: now, updatedAt: now });
          put(ref, { startedAt: null });
        } else if (p.cancel) put(ref, { startedAt: null });
        else {
          if (timer?.startedAt) fail('Stop the active timer first');
          await get('jobs', p.jobId);
          put(ref, { jobId: id(p.jobId), workerId: 'owner', startedAt: now, date: date(p.date), kind: p.kind === 'travel' ? 'travel' : 'work', costRateCents: settings.costRateCents, billRateCents: settings.billRateCents, notes: '' });
        }
      } else if (input.action === 'issueEstimate') {
        if (!settings.name) fail('Complete business settings first');
        const record = await get('estimates', input.id); const e = record.data;
        if (e.status !== 'draft') fail('Only a draft can be issued');
        const client = (await get('clients', e.clientId)).data;
        const previous = e.supersedesId ? await get('estimates', e.supersedesId) : null;
        if (previous && (previous.data.clientId !== e.clientId || previous.data.status === 'accepted' || previous.data.status === 'superseded')) fail('Cannot supersede this estimate');
        const totals = F.estimate(e);
        const number = `${settings.estimatePrefix}-${String(settings.nextEstimate).padStart(4, '0')}`;
        const document = makeDocument('Estimate', number, p.date ? date(p.date) : now.slice(0, 10), e.expiresDate, settings, client, e, totals);
        const issued = { ...e, totals, document, status: 'issued', issuedAt: now, updatedAt: now };
        put(record.ref, issued); put(record.ref.collection('revisions').doc('issued'), issued);
        if (previous) put(previous.ref, { ...previous.data, status: 'superseded', supersededBy: e.id, updatedAt: now });
        put(settingsRef, { ...settings, nextEstimate: settings.nextEstimate + 1 });
        event('Estimate issued', e.clientId, '', e.id); result.id = e.id;
      } else if (input.action === 'estimateDecision') {
        const record = await get('estimates', input.id); const e = record.data;
        if (e.status !== 'issued') fail('Only issued estimates can receive a decision');
        if (!['accepted', 'declined', 'expired'].includes(p.status)) fail('Invalid decision');
        put(record.ref, { ...e, status: p.status, decisionDate: date(p.date), decisionNote: text(p.note), evidencePath: image(p.evidencePath, uid), updatedAt: now });
        event(`Estimate ${p.status}`, e.clientId, '', e.id);
      } else if (input.action === 'convertJob') {
        const record = await get('estimates', input.id); const e = record.data;
        if (e.status !== 'accepted') fail('Accept the estimate before creating a job');
        if (e.jobId) result.id = e.jobId;
        else {
          const jobId = `job_${e.id}`;
          const job = await get('jobs', jobId, true);
          if (job.data) fail('Job already exists');
          put(job.ref, { title: e.title, location: e.location, clientId: e.clientId, estimateId: e.id, baseline: e.totals, document: e.document, status: 'scheduled', notes: '', lessons: '', version: 1, createdAt: now, updatedAt: now });
          put(record.ref, { ...e, jobId, updatedAt: now });
          event('Job scheduled', e.clientId, jobId, jobId); result.id = jobId;
        }
      } else if (input.action === 'approveChange') {
        const record = await get('changes', input.id); const c = record.data;
        const job = (await get('jobs', c.jobId)).data;
        if (c.status !== 'draft') fail('Change has already been approved');
        const changeRecords = await tx.get(root.collection('changes').where('jobId', '==', job.id));
        const approved = [...changeRecords.docs.map(s => s.data()).filter(v => v.status === 'approved'), c];
        if (job.baseline.revenueCents + F.sum(approved.map(v => v.priceCents)) < 0
          || job.baseline.directCents + F.sum(approved.map(v => v.costCents)) < 0
          || job.baseline.minutes + F.sum(approved.map(v => v.minutes)) < 0
          || job.baseline.taxableCents + F.sum(approved.filter(v => v.taxable).map(v => v.priceCents)) < 0) fail('Change would produce a negative contract, cost forecast, hours, or taxable amount');
        if (job.invoiceId) put(root.collection('jobs').doc(job.id), { ...job, needsInvoiceReplacement: true, version: job.version + 1, updatedAt: now });
        put(record.ref, { ...c, status: 'approved', approvalDate: date(p.date), approvalNote: text(p.note), evidencePath: image(p.evidencePath, uid), updatedAt: now });
        event('Change approved', c.clientId, c.jobId, c.id);
      } else if (input.action === 'issueInvoice') {
        const jobRecord = await get('jobs', input.id); const job = jobRecord.data;
        const client = (await get('clients', job.clientId)).data;
        const previous = job.invoiceId ? await get('invoices', job.invoiceId) : null;
        if (previous && !p.replace) fail('This job already has an invoice');
        if (previous && !text(p.reason)) fail('Explain why this invoice is being replaced');
        const changes = await tx.get(root.collection('changes').where('jobId', '==', job.id));
        const approved = changes.docs.map(s => s.data()).filter(c => c.status === 'approved');
        const base = job.baseline;
        const taxableChanges = F.sum(approved.filter(c => c.taxable).map(c => c.priceCents));
        const subtotalCents = base.subtotalCents + F.sum(approved.map(c => c.priceCents));
        const taxCents = Math.round((base.taxableCents + taxableChanges) * base.taxPercent / 100);
        const totals = { subtotalCents, discountCents: base.discountCents, taxCents, totalCents: subtotalCents - base.discountCents + taxCents };
        if (totals.totalCents < 0 || taxCents < 0) fail('Changes produce a negative invoice or tax');
        const key = input.requestId;
        const number = `${settings.invoicePrefix}-${String(settings.nextInvoice).padStart(4, '0')}`;
        const source = { title: job.title, location: job.location, terms: p.terms ?? job.document.terms, lines: [...base.lines, ...approved.map(c => ({ group: 'Approved changes', description: c.description, priceCents: c.priceCents }))] };
        if (date(p.dueDate) < date(p.date)) fail('Due date cannot precede invoice date');
        const document = makeDocument('Invoice', number, date(p.date), date(p.dueDate), settings, client, source, totals);
        put(root.collection('invoices').doc(key), { jobId: job.id, clientId: job.clientId, status: 'issued', replacesId: previous?.data.id || '', document, totalCents: totals.totalCents, createdAt: now, updatedAt: now });
        if (previous) put(previous.ref, { ...previous.data, status: 'void', replacedBy: key, voidReason: text(p.reason), updatedAt: now });
        put(jobRecord.ref, { ...job, invoiceId: key, needsInvoiceReplacement: false, updatedAt: now, version: job.version + 1 });
        put(settingsRef, { ...settings, nextInvoice: settings.nextInvoice + 1 });
        event('Invoice issued', job.clientId, job.id, key); result.id = key;
      } else if (input.action === 'recordPayment') {
        const job = (await get('jobs', p.jobId)).data;
        const provider = paymentProvider(p.provider || 'manual');
        if (!amount(p.amountCents)) fail('Payment must be greater than zero');
        put(root.collection('payments').doc(input.requestId), { jobId: job.id, clientId: job.clientId, amountCents: p.amountCents, date: date(p.date), method: text(p.method, 60), reference: text(p.reference, 200), provider: provider.name, externalPaymentId: null, invoiceId: job.invoiceId || '', voided: false, createdAt: now, updatedAt: now });
        event('Payment recorded', job.clientId, job.id, input.requestId);
      } else if (input.action === 'voidEntry') {
        if (!['payments', 'timeEntries', 'expenses'].includes(input.collection)) fail('Cannot void this record');
        const record = await get(input.collection, input.id);
        if (!text(p.reason)) fail('A reason is required');
        if (record.data.voided) fail('Already voided');
        put(record.ref, { ...record.data, voided: true, voidReason: text(p.reason), updatedAt: now });
        event(`${input.collection} entry voided`, record.data.clientId, record.data.jobId, input.id);
      } else fail('Unsupported action');
      writes.forEach(write => write());
      tx.set(requestRef, { fingerprint, result, createdAt: now });
      return result;
    });
  };
}
function makeDocument(kind, number, day, dueDate, settings, client, source, totals) {
  return { kind, number, date: day, dueDate: dueDate || '', business: { name: settings.name, contact: settings.contact, logoPath: settings.logoPath }, client: { name: client.name || '', email: client.email || '', address: client.address || '' }, title: source.title, location: source.location, lines: source.lines.map(l => ({ group: l.group || '', description: l.description, priceCents: l.priceCents })), subtotalCents: totals.subtotalCents, discountCents: totals.discountCents, taxCents: totals.taxCents, totalCents: totals.totalCents, terms: source.terms || '', paymentInstructions: kind === 'Invoice' ? settings.paymentInstructions : '' };
}
module.exports = { createService, defaultSettings, overlaps, makeDocument };
