import * as API from './api.js';
import { escape as e, money, preview } from './documents.js';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
const F = window.BusinessFinance;
const $ = selector => document.querySelector(selector);
let stopAccessWatch;
const state = { view: 'Overview', data: {}, settings: {}, timer: null, selected: null, page: 0, calendarMode: 'month', calendarDate: new Date(), form: null, authorized: false, generation: 0 };
const views = ['Overview', 'Clients', 'Estimates', 'Jobs', 'Calendar', 'Expenses', 'Reports', 'Settings'];
const all = type => state.data[type] || [];
const find = (type, id) => all(type).find(r => r.id === id);
const active = type => all(type).filter(r => !r.archived && !r.voided);
const clientName = id => find('clients', id)?.name || 'Client';
const jobName = id => find('jobs', id)?.title || 'Job';
const workerName = id => id === 'owner' ? 'Owner' : find('workers', id)?.name || 'Helper';
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.timezone || 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const localDate = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const btn = (label, attrs, secondary = true) => `<button type="button" ${attrs} class="${secondary ? 'secondary' : ''}">${e(label)}</button>`;
const empty = (title, description) => `<div class="empty"><strong>${e(title)}</strong>${e(description)}</div>`;
const pill = status => `<span class="pill ${e(status)}">${e(status)}</span>`;
const heading = (title, action = '') => `<div class="section-head"><h2>${e(title)}</h2>${action}</div>`;
const metrics = items => `<div class="metrics">${items.map(([label, value]) => `<div><span class="help">${e(label)}</span><strong>${e(value)}</strong></div>`).join('')}</div>`;
const row = (title, subtitle, actions = '') => `<div class="row"><div><strong>${e(title)}</strong><p><small>${e(subtitle)}</small></p></div><div class="actions">${actions}</div></div>`;
function notice(message = '', error = false) { $('#notice').textContent = message; $('#notice').className = error ? 'error' : ''; }
function report(job) { return F.report(job, active('timeEntries'), active('expenses'), all('changes'), all('payments')); }
function invoiceBalance(invoice) { return F.paymentsBalance(invoice.document.totalCents, all('payments').filter(p => p.jobId === invoice.jobId)); }
function clientPayments(id) { return all('payments').filter(p => p.clientId === id); }
function csv(name, columns, rows) {
  const quote = v => '"' + String(v ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
  const blob = new Blob(['\uFEFF' + [columns, ...rows].map(r => r.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const dependencies = {
  Overview: ['clients', 'estimates', 'jobs', 'visits', 'expenses', 'invoices', 'payments', 'opportunities'],
  Clients: ['clients', 'estimates', 'jobs', 'invoices', 'payments', 'opportunities', 'activity'],
  Estimates: ['clients', 'estimates', 'jobs', 'templates'],
  Jobs: ['clients', 'estimates', 'jobs', 'visits', 'workers', 'timeEntries', 'expenses', 'changes', 'invoices', 'payments', 'photos'],
  Calendar: ['clients', 'jobs', 'visits', 'workers'],
  Expenses: ['clients', 'jobs', 'expenses'],
  Reports: ['clients', 'jobs', 'timeEntries', 'expenses', 'changes', 'payments'],
  Settings: ['workers', 'templates'],
};
async function load() {
  const generation = ++state.generation;
  $('#content').setAttribute('aria-busy', 'true');
  const [settings, timer, ...records] = await Promise.all([API.record('settings', 'profile'), API.record('settings', 'timer'), ...dependencies[state.view].map(API.list)]);
  if (generation !== state.generation || !state.authorized) return;
  state.settings = settings || {}; state.timer = timer;
  dependencies[state.view].forEach((key, i) => { state.data[key] = records[i]; });
  $('#business-name').textContent = state.settings.name || 'Your business';
  $('#content').removeAttribute('aria-busy'); render(); renderTimer();
}
async function navigate(view, selected = null) {
  if ($('#editor').open && !confirm('Leave this form? Unsaved changes will be lost.')) return;
  state.view = view; state.selected = selected; state.page = 0;
  $('#page-title').textContent = view;
  $('#navigation').innerHTML = views.map(v => `<button type="button" data-view="${v}" ${v === view ? 'aria-current="page"' : ''}>${v}</button>`).join('');
  $('#content').innerHTML = empty('Loading your workspace', 'Fetching the latest records…');
  try { await load(); } catch (err) { notice(err.message, true); $('#content').innerHTML = empty('Unable to load', 'Check your connection, then retry.'); $('#content').insertAdjacentHTML('beforeend', btn('Retry', 'data-reload')); }
}
function paged(records, template) {
  const sorted = [...records].sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  const start = state.page * 25;
  return sorted.slice(start, start + 25).map(template).join('') + (records.length > 25 ? `<div class="section-head">${btn('Previous', `data-page="${Math.max(0, state.page - 1)}" ${!state.page ? 'disabled' : ''}`)}<span>${start + 1}–${Math.min(start + 25, records.length)} of ${records.length}</span>${btn('Next', `data-page="${state.page + 1}" ${start + 25 >= records.length ? 'disabled' : ''}`)}</div>` : '');
}
function render() {
  const content = $('#content');
  if (!state.settings.name && state.view !== 'Settings') { content.innerHTML = `<section class="panel">${empty('Make it your business', 'Set your business name, rates, branding, and document details to get started.')}${btn('Set up business', 'data-view="Settings"', false)}</section>`; return; }
  if (state.view === 'Overview') content.innerHTML = overview();
  if (state.view === 'Clients') content.innerHTML = clients();
  if (state.view === 'Estimates') content.innerHTML = estimates();
  if (state.view === 'Jobs') content.innerHTML = jobs();
  if (state.view === 'Calendar') content.innerHTML = calendar();
  if (state.view === 'Expenses') content.innerHTML = expenses();
  if (state.view === 'Reports') content.innerHTML = reports();
  if (state.view === 'Settings') content.innerHTML = settings();
}
function overview() {
  const outstanding = all('invoices').filter(i => i.status !== 'void');
  const balance = F.sum(outstanding.map(i => Math.max(0, invoiceBalance(i).balanceCents)));
  const unassigned = active('expenses').filter(x => !x.allocations.length);
  const openEstimates = all('estimates').filter(x => x.status === 'issued');
  const overdue = [...active('clients'), ...active('opportunities')].filter(x => x.followUpDate && x.followUpDate <= day());
  const upcoming = all('visits').filter(v => v.date >= day()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 5);
  return `<div class="cards">${[['Active jobs', active('jobs').filter(j => !['completed', 'cancelled'].includes(j.status)).length, 'Work on the books'], ['Awaiting decisions', openEstimates.length, 'Issued estimates'], ['Outstanding', money(balance), 'Invoice balance'], ['Unassigned receipts', unassigned.length, money(F.sum(unassigned.map(x => x.amountCents)))]].map(([label, value, note]) => `<section class="card"><span class="eyebrow">${label}</span><strong>${value}</strong><small>${note}</small></section>`).join('')}</div><div class="grid"><section class="panel">${heading('Coming up', btn('Calendar', 'data-view="Calendar"'))}${upcoming.map(v => row(jobName(v.jobId), `${v.date} · ${v.start}–${v.end}`, btn('Open job', `data-job="${v.jobId}"`))).join('') || empty('Room for the next job', 'Scheduled visits will appear here.')}</section><section class="panel">${heading('Keep the conversation going', btn('Clients', 'data-view="Clients"'))}${overdue.map(x => row(x.title || x.name, `Follow up ${x.followUpDate}`, btn('Open', `data-client="${x.clientId || x.id}"`))).join('') || empty('All caught up', 'Dated client follow-ups and opportunities appear here.')}</section></div><section class="panel">${heading('Move the next job forward', btn('New estimate', 'data-new="estimates"', false))}${openEstimates.slice(0, 5).map(x => row(x.title, `${clientName(x.clientId)} · ${money(x.totals.totalCents)}`, btn('Review estimate', `data-estimate="${x.id}"`))).join('') || empty('Start with a good estimate', 'Build the scope, check the numbers, and send a document you’re proud of.')}</section>`;
}
function clients() {
  const c = find('clients', state.selected);
  if (c) return `<div class="section-head">${btn('← All clients', 'data-view="Clients"')}${btn('Edit client', `data-edit="clients" data-id="${c.id}"`)}</div><section class="panel"><p class="eyebrow">Client file ${c.archived ? '· Archived' : ''}</p><h2>${e(c.name)}</h2><p>${e(c.email)} · ${e(c.phone)}</p><p class="preserve">${e(c.address)}</p><p>${e(c.locations)}</p><p>${e(c.notes)}</p>${c.followUpDate ? `<p>Follow up: ${e(c.followUpDate)}</p>` : ''}</section><div class="grid"><section class="panel">${heading('Estimates', btn('New estimate', `data-new="estimates" data-client-id="${c.id}"`))}${all('estimates').filter(x => x.clientId === c.id).map(x => row(x.title, `${x.status} · ${money(x.totals.totalCents)}`, btn('Open', `data-estimate="${x.id}"`))).join('') || empty('No estimates yet', 'Start with the next piece of work.')}${heading('Jobs')}${all('jobs').filter(x => x.clientId === c.id).map(x => row(x.title, x.status, btn('Open', `data-job="${x.id}"`))).join('')}</section><section class="panel">${heading('Future work', btn('Add opportunity', `data-new="opportunities" data-client-id="${c.id}"`))}${all('opportunities').filter(x => x.clientId === c.id).map(x => row(x.title, `${x.followUpDate || 'No reminder'} · ${x.archived ? 'Archived' : x.notes}`, btn('Edit', `data-edit="opportunities" data-id="${x.id}"`))).join('') || empty('The next conversation', 'Capture work they might want in the future.')}${heading('Invoices & payments')}${all('invoices').filter(x => x.clientId === c.id).map(x => row(x.document.number, `${x.status} · ${money(x.document.totalCents)}`, btn('Preview', `data-preview="invoices" data-id="${x.id}"`))).join('')}${clientPayments(c.id).map(p => row(`${money(p.amountCents)} · ${p.method}`, `${p.date}${p.voided ? ' · Voided' : ''}`)).join('')}</section></div><section class="panel">${heading('Client timeline')}${all('activity').filter(a => a.clientId === c.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(a => row(a.action, a.createdAt.slice(0, 10))).join('') || empty('History starts here', 'Document and job milestones are recorded automatically.')}</section>`;
  return `<section class="panel">${heading('People behind the projects', btn('Add client', 'data-new="clients"', false))}${paged(all('clients'), c => row(c.name, `${c.email || c.phone || 'Add contact details'}${c.archived ? ' · Archived' : ''}`, btn('Open client', `data-client="${c.id}"`))) || empty('Your next client belongs here', 'Keep contact details, work history, and follow-ups together.')}</section>`;
}
function estimateActions(x) {
  let html = btn('Preview / PDF', `data-preview="estimates" data-id="${x.id}"`);
  if (x.status === 'draft') return btn('Edit', `data-edit="estimates" data-id="${x.id}"`) + btn('Issue estimate', `data-action="issueEstimate" data-id="${x.id}"`, false);
  if (x.status === 'issued') html += btn('Record decision', `data-decision="${x.id}"`);
  if (!['accepted', 'superseded'].includes(x.status)) html += btn('New revision', `data-revise="${x.id}"`);
  if (x.status === 'accepted') html += x.jobId ? btn('Open job', `data-job="${x.jobId}"`) : btn('Create job', `data-action="convertJob" data-id="${x.id}"`, false);
  return html;
}
function estimates() {
  const x = find('estimates', state.selected);
  if (x) return `<div class="section-head">${btn('← All estimates', 'data-view="Estimates"')}<div class="actions">${estimateActions(x)}</div></div><section class="panel"><p class="eyebrow">${e(x.document?.number || 'Draft estimate')} · ${e(clientName(x.clientId))}</p><h2>${e(x.title)}</h2>${pill(x.status)}${x.decisionDate ? `<p>Decision recorded ${e(x.decisionDate)} · ${e(x.decisionNote)} ${x.evidencePath ? btn('View decision evidence', `data-image="${e(x.evidencePath)}"`) : ''}</p>` : ''}${metrics([['Client total', money(x.totals.totalCents)], ['Direct costs', money(x.totals.directCents)], ['Overhead', money(x.totals.overheadCents)], ['Projected profit', money(x.totals.profitCents)], ['Margin', `${x.totals.marginPercent.toFixed(1)}%`], ['Markup', `${x.totals.markupPercent.toFixed(1)}%`]])}<p class="help">Margin is profit ÷ selling revenue. Markup is profit ÷ total estimated cost. Tax is excluded from both.</p>${x.lines.map(l => row(l.description, `${l.group} · ${l.minutes / 60} hours · Cost ${money(l.directCents)}`, `<strong>${money(l.priceCents)}</strong>`)).join('')}<p class="help">Internal notes: ${e(x.notes)}</p></section>`;
  return `<section class="panel">${heading('Price the work with confidence', btn('Build estimate', 'data-new="estimates"', false))}${paged(all('estimates'), x => row(x.title, `${clientName(x.clientId)} · ${x.document?.number || 'Draft'} · ${money(x.totals.totalCents)}`, pill(x.status) + btn('Open', `data-estimate="${x.id}"`))) || empty('Know your numbers first', 'Build internal costs and a clear client price in one place.')}</section>`;
}
function jobs() {
  const j = find('jobs', state.selected);
  if (!j) return `<section class="panel">${heading('From approved scope to finished work', btn('Estimates', 'data-view="Estimates"'))}${paged(all('jobs'), j => row(j.title, clientName(j.clientId), pill(j.status) + btn('Open job', `data-job="${j.id}"`))) || empty('Good work starts with an agreement', 'Accept an estimate, then create its job.')}</section>`;
  const r = report(j);
  const related = type => all(type).filter(x => x.jobId === j.id);
  const invoice = find('invoices', j.invoiceId);
  const scoped = type => `data-new="${type}" data-job-id="${j.id}"`;
  return `<div class="section-head">${btn('← All jobs', 'data-view="Jobs"')}<div class="actions">${btn('Job status & notes', `data-edit="jobs" data-id="${j.id}"`)}${btn(invoice ? 'Replace invoice' : 'Create invoice', `data-invoice="${j.id}"`, false)}</div></div><section class="panel"><p class="eyebrow">${e(clientName(j.clientId))} · ${e(j.location)}</p><h2>${e(j.title)}</h2>${pill(j.status)}${j.needsInvoiceReplacement ? '<p class="error">Approved changes were added after this invoice. Replace the invoice before sending the updated amount to the client.</p>' : ''}${metrics([['Original price, pretax', money(r.originalRevenueCents)], ['Approved changes', money(r.changeRevenueCents)], ['Actual cost + overhead', money(r.actualCostCents)], ['Current job profit', money(r.profitCents)], ['Collected', money(r.collectedCents)]])}<p class="help">Profit compares the full fixed-price contract with costs recorded so far; it is provisional until all costs are entered. Collections are separate.</p><p>${e(j.notes)}</p></section><div class="grid"><section class="panel">${heading('Schedule & crew', btn('Schedule visit', scoped('visits')))}${related('visits').map(v => row(`${v.date} · ${v.start}–${v.end}`, v.workerIds.map(workerName).join(', '), btn('Edit', `data-edit="visits" data-id="${v.id}"`))).join('') || empty('Give the work a date', 'Schedule visits and assign yourself or helpers.')}${heading('Time & travel', btn('Log time', scoped('timeEntries')))}<div class="actions">${btn('Start work timer', `data-timer="start" data-id="${j.id}" data-kind="work"`)}${btn('Start travel timer', `data-timer="start" data-id="${j.id}" data-kind="travel"`)}</div>${related('timeEntries').map(t => row(`${t.minutes} min · ${workerName(t.workerId)} · ${t.kind}`, `${t.date} · ${money(F.labor(t.minutes, t.costRateCents) + t.mileageCents)}${t.voided ? ' · Voided' : ''}`, !t.voided ? btn('Void', `data-void="timeEntries" data-id="${t.id}"`) : '')).join('')}</section><section class="panel">${heading('Changes to the agreement', btn('Add change', scoped('changes')))}${related('changes').map(c => row(c.description, `${money(c.priceCents)} · ${c.status}${c.approvalDate ? ' · ' + c.approvalDate + ' · ' + c.approvalNote : ''}`, c.status === 'draft' ? btn('Edit', `data-edit="changes" data-id="${c.id}"`) + btn('Record approval', `data-approve="${c.id}"`) : c.evidencePath ? btn('View approval evidence', `data-image="${e(c.evidencePath)}"`) : '')).join('') || empty('Keep added work visible', 'Agree on scope and price before it becomes forgotten work.')}${heading('Invoices & payments', btn('Record payment', scoped('payments')))}${related('invoices').map(i => row(i.document.number, `${i.status} · ${money(i.document.totalCents)}${i.status !== 'void' ? ` · Balance ${money(invoiceBalance(i).balanceCents)}` : ''}`, btn('Preview / PDF', `data-preview="invoices" data-id="${i.id}"`))).join('')}${related('payments').map(p => row(`${money(p.amountCents)} · ${p.method}`, `${p.date}${p.voided ? ' · Voided' : ''}`, !p.voided ? btn('Void', `data-void="payments" data-id="${p.id}"`) : '')).join('')}</section></div><section class="panel">${heading('Purchases & receipts', btn('Add expense', scoped('expenses')))}${active('expenses').filter(x => x.allocations.some(a => a.jobId === j.id)).map(x => row(x.merchant || x.category, `${x.date} · ${money(F.sum(x.allocations.filter(a => a.jobId === j.id).map(a => a.amountCents)))}`, btn('Edit / receipt', `data-edit="expenses" data-id="${x.id}"`))).join('') || empty('Every purchase counts', 'Assign receipts here to make actual costs meaningful.')}</section><section class="panel">${heading('Photos of the work', btn('Add photo', scoped('photos')))}<div class="gallery">${related('photos').map(p => `<div><button class="secondary" data-image="${e(p.path)}">View ${e(p.kind)} photo</button><p>${e(p.caption)}</p></div>`).join('') || empty('Document the transformation', 'Keep before, progress, and after photos with the job.')}</div></section><section class="panel">${heading('Closeout & lessons', btn('Edit lessons', `data-edit="jobs" data-id="${j.id}"`))}${comparison(j, r)}<p>${e(j.lessons || 'What would you price differently next time? Add lessons after reviewing the numbers.')}</p><p class="help">Update reusable estimate items explicitly in Settings when a lesson should change future pricing.</p></section>`;
}
function comparison(j, r) {
  const base = j.baseline;
  const original = { labor: F.sum(base.lines.map(l => l.laborCents)), materials: F.sum(base.lines.map(l => l.materialCents)), subcontractors: F.sum(base.lines.map(l => l.subcontractCents)), travel: F.sum(base.lines.map(l => l.travelCents)), other: F.sum(base.lines.map(l => l.otherCents)) };
  const categories = [...new Set([...Object.keys(original), ...Object.keys(r.categories)])];
  return `<div class="table-scroll"><table><thead><tr><th>Measure</th><th class="money">Original estimate</th><th class="money">Revised forecast</th><th class="money">Actual</th></tr></thead><tbody><tr><td>Labor / travel hours</td><td class="money">${(r.estimatedMinutes / 60).toFixed(2)}</td><td class="money">${(r.revisedMinutes / 60).toFixed(2)}</td><td class="money">${(r.actualMinutes / 60).toFixed(2)}</td></tr>${categories.map(c => `<tr><td>${e(c)}</td><td class="money">${money(original[c] || 0)}</td><td class="money">${money(r.revisedCategories[c] || 0)}</td><td class="money">${money(r.categories[c] || 0)}</td></tr>`).join('')}<tr><td>Total cost incl. overhead</td><td class="money">${money(r.originalCostCents)}</td><td class="money">${money(r.revisedCostCents)}</td><td class="money">${money(r.actualCostCents)}</td></tr><tr><td>Pretax revenue / profit</td><td class="money">${money(r.originalRevenueCents)}</td><td class="money">${money(r.revenueCents)}</td><td class="money">${money(r.profitCents)} profit</td></tr></tbody></table></div>`;
}
function calendar() {
  const anchor = state.calendarDate;
  const label = anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), state.calendarMode === 'month' ? 1 : anchor.getDate());
  first.setDate(first.getDate() - first.getDay());
  const days = state.calendarMode === 'month' ? 42 : 7;
  const visits = [...all('visits')].sort((a,b) => (a.date+a.start).localeCompare(b.date+b.start));
  return `<section class="panel">${heading(label, `<div class="actions">${btn('←', 'data-calendar-step="-1"')}${btn('Today', 'data-calendar-today')}${btn('→', 'data-calendar-step="1"')}${['month','week','agenda'].map(m => btn(m, `data-calendar-mode="${m}"`)).join('')}${btn('Schedule visit', 'data-new="visits"', false)}</div>`)}<p class="help">Business timezone: ${e(state.settings.timezone)}. Assign helpers in Settings. Conflicts require an explicit override.</p>${state.calendarMode === 'agenda' ? visits.map(v => row(`${v.date} · ${v.start}–${v.end} · ${jobName(v.jobId)}`, v.workerIds.map(workerName).join(', '), btn('Edit', `data-edit="visits" data-id="${v.id}"`))).join('') || empty('An open calendar', 'Schedule the next visit.') : `<div class="table-scroll"><div class="calendar ${state.calendarMode}">${Array.from({length:days}, (_, i) => { const d = new Date(first); d.setDate(d.getDate()+i); return `<div class="day"><small>${e(d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }))}</small>${visits.filter(v => v.date === localDate(d)).map(v => `<button data-edit="visits" data-id="${v.id}">${e(v.start)} ${e(jobName(v.jobId))}<br>${e(v.workerIds.map(workerName).join(', '))}</button>`).join('')}</div>`; }).join('')}</div></div>`}</section>`;
}
function expenses() {
  return `<section class="panel">${heading('Small purchases. Clearer numbers.', `<div class="actions">${btn('Export CSV', 'data-export="expenses"')}${btn('Add receipt / expense', 'data-new="expenses"', false)}</div>`)}<p class="help">Capture now, allocate later. Mileage uses a per-mile cost; fuel receipts remain separate purchases. Avoid assigning the same fuel cost twice.</p>${paged(all('expenses'), x => row(x.merchant || 'Expense', `${x.date} · ${x.category} · ${money(x.amountCents)} · ${x.voided ? 'Voided' : !x.allocations.length ? 'Unassigned' : x.allocations.map(a => a.jobId ? jobName(a.jobId) : a.clientId ? clientName(a.clientId) + ' (not job-costed)' : 'Business overhead').join(', ')}`, !x.voided ? btn('Edit / receipt', `data-edit="expenses" data-id="${x.id}"`) + btn('Void', `data-void="expenses" data-id="${x.id}"`) : '')) || empty('Don’t lose another receipt', 'Photograph it, enter the amount, and choose where it belongs.')}</section>`;
}
function reports() {
  const unassigned = active('expenses').filter(x => !x.allocations.length);
  const nonjob = F.sum(active('expenses').flatMap(x => x.allocations.filter(a => !a.jobId).map(a => a.amountCents)));
  return `<section class="panel">${heading('Learn from every job', btn('Export job costs', 'data-export="jobs"'))}${metrics([['Unassigned expenses', money(F.sum(unassigned.map(x => x.amountCents)))], ['Overhead / customer-only allocations', money(nonjob)]])}<p class="help">Unassigned and non-job purchases are excluded from job profit. Allocated overhead is a costing allowance, not an additional receipt. Review these figures before treating a job as fully costed.</p>${all('jobs').map(j => `<details><summary>${e(j.title)} · ${e(j.status)} · ${money(report(j).profitCents)} current profit</summary>${comparison(j, report(j))}<p>${e(j.lessons)}</p>${btn('Open job', `data-job="${j.id}"`)}</details>`).join('') || empty('Better estimates start with actuals', 'Job comparisons appear as soon as you create your first job.')}</section>`;
}
function settings() {
  return `<section class="panel">${heading('A business that looks like yours', btn(state.settings.name ? 'Edit business settings' : 'Set up business', 'data-settings', false))}<h3>${e(state.settings.name || 'Your business name')}</h3><p>${e(state.settings.contact || 'Add contact information for client documents.')}</p><p class="help">${e(state.settings.timezone || 'America/Chicago')} · USD · Fixed-price jobs</p>${metrics([['Owner labor cost / hour', money(state.settings.costRateCents)], ['Mileage cost / mile', money(state.settings.mileageRateCents)], ['Overhead', `${state.settings.overheadPercent || 0}%`], ['Default markup', `${state.settings.markupPercent || 0}%`]])}<p>Payments: manual tracking enabled. Stripe integration reserved; online processing is not connected.</p></section><div class="grid"><section class="panel">${heading('Your helpers', btn('Add helper', 'data-new="workers"'))}${all('workers').map(w => row(w.name, `${money(w.costRateCents)}/hr cost · ${money(w.billRateCents)}/hr bill${w.archived ? ' · Archived' : ''}`, btn('Edit', `data-edit="workers" data-id="${w.id}"`))).join('') || empty('A roster without extra accounts', 'Schedule helpers and record their time yourself.')}</section><section class="panel">${heading('Reusable estimate items', btn('Add template', 'data-new="templates"'))}${all('templates').map(t => row(t.description, `${money(t.priceCents)} price${t.archived ? ' · Archived' : ''}`, btn('Edit', `data-edit="templates" data-id="${t.id}"`))).join('') || empty('Keep what works', 'Save common work and improve it as you learn.')}</section></div>`;
}
const input = (name, label, value = '', type = 'text', extra = '') => `<label>${e(label)}<input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
const dollars = (name, label, cents = 0, signed = false) => input(name, label, ((cents || 0) / 100).toFixed(2), 'number', `step="0.01" ${signed ? '' : 'min="0"'} required`);
const area = (name, label, value = '') => `<label class="wide">${e(label)}<textarea name="${name}">${e(value)}</textarea></label>`;
const check = (name, label, checked = false) => `<label class="check"><input name="${name}" type="checkbox" ${checked ? 'checked' : ''}>${e(label)}</label>`;
const select = (name, label, options, value = '', required = true) => `<label>${e(label)}<select aria-label="${e(label)}" name="${name}" ${required ? 'required' : ''}>${options.map(([key, label]) => `<option value="${e(key)}" ${key === value ? 'selected' : ''}>${e(label)}</option>`).join('')}</select></label>`;
const clientSelect = value => select('clientId', 'Client', [['', 'Choose a client'], ...active('clients').map(c => [c.id, c.name])], value);
const jobSelect = value => select('jobId', 'Job', [['', 'Choose a job'], ...active('jobs').map(j => [j.id, j.title])], value);
const fileInput = (name, label, existing = '') => `<label class="wide">${e(label)}<input type="file" name="${name}" accept="image/jpeg,image/png,image/webp" ${name === 'receipt' || name === 'photo' ? 'capture="environment"' : ''}><span class="help">JPEG, PNG or WebP · up to 10 MB. Export HEIC as JPEG first.</span>${existing ? `<button type="button" class="secondary" data-image="${e(existing)}">View current image</button>` : ''}</label>`;
function lineFields(line = {}, template = false) {
  return `<fieldset class="scope-line"><legend>${template ? 'Reusable work item' : 'Scope item'}</legend><div class="fields">${input('group', 'Group / phase', line.group || '')}${input('description', 'Client-visible description', line.description || '', 'text', 'required maxlength="4000"')}${input('minutes', 'Planned labor minutes', line.minutes || 0, 'number', 'min="0" step="1" required')}${dollars('costRateCents', 'Labor cost / hour ($)', line.costRateCents ?? state.settings.costRateCents)}${input('materialQuantity', 'Material quantity', line.materialQuantity ?? 1, 'number', 'min="0" max="1000000" step="0.01"')}${dollars('materialUnitCostCents', 'Material cost / unit ($)', line.materialUnitCostCents ?? line.materialCents)}${dollars('subcontractCents', 'Subcontractors ($)', line.subcontractCents)}${dollars('travelCents', 'Travel allowance ($)', line.travelCents)}${dollars('otherCents', 'Other direct costs ($)', line.otherCents)}${input('markupPercent', 'Suggested markup (%)', state.settings.markupPercent || 0, 'number', 'min="0" max="1000" step="0.01"')}${input('priceCents', 'Client selling price ($), blank = markup', line.priceCents == null ? '' : (line.priceCents / 100).toFixed(2), 'number', 'min="0" step="0.01"')}${check('taxable', 'Taxable selling line', line.taxable)}${!template ? btn('Remove item', 'data-remove-line') : ''}</div></fieldset>`;
}
function allocationFields(a = {}) {
  return `<fieldset class="allocation"><legend>Allocation</legend><div class="fields">${select('jobId', 'Job (optional)', [['', 'No job / overhead'], ...active('jobs').map(j => [j.id, j.title])], a.jobId || '', false)}${select('clientId', 'Customer if no job (optional)', [['', 'Business overhead'], ...active('clients').map(c => [c.id, c.name])], a.clientId || '', false)}${dollars('amountCents', 'Allocated amount ($)', a.amountCents)}${btn('Remove allocation', 'data-remove-allocation')}</div></fieldset>`;
}
async function edit(type, record = {}, options = {}) {
  if (!state.authorized) return;
  notice();
  // Fetch the related choices needed by quick-add without subscribing to hidden views.
  const needs = ['clients', 'jobs', 'workers', 'templates'];
  try { await Promise.all(needs.filter(k => !state.data[k]).map(async k => { state.data[k] = await API.list(k); })); } catch (err) { notice(err.message, true); return; }
  const v = { ...record, ...options };
  const id = options.newRevision ? null : record.id;
  state.form = { type, id, original: v, requestId: crypto.randomUUID(), lastInput: '', uploaded: {} };
  $('#editor-title').textContent = type === 'settings' ? 'Business settings' : type === 'decision' ? 'Record estimate decision' : type === 'approval' ? 'Record change approval' : type === 'invoice' ? 'Issue client invoice' : `${id ? 'Edit' : 'New'} ${({clients:'client',estimates:'estimate',jobs:'job',visits:'visit',workers:'helper',timeEntries:'time entry',expenses:'expense',changes:'change order',payments:'payment',photos:'job photo',opportunities:'opportunity',templates:'estimate template'})[type] || type}`;
  const fields = [];
  if (type === 'settings') fields.push(input('name', 'Business name', v.name || '', 'text', 'required maxlength="120"'), area('contact', 'Business contact details', v.contact), input('timezone', 'Business timezone', v.timezone || 'America/Chicago', 'text', 'required'), dollars('costRateCents','Owner labor cost / hour ($)',v.costRateCents), dollars('billRateCents','Default bill rate / hour ($)',v.billRateCents), dollars('mileageRateCents','Mileage cost / mile ($)',v.mileageRateCents), input('overheadPercent','Overhead on direct costs (%)',v.overheadPercent || 0,'number','min="0" max="1000" step="0.01"'), input('taxPercent','Default sales tax (%)',v.taxPercent || 0,'number','min="0" max="1000" step="0.01"'), input('markupPercent','Default markup (%)',v.markupPercent || 0,'number','min="0" max="1000" step="0.01"'), input('estimatePrefix','Estimate number prefix',v.estimatePrefix || 'EST'), input('invoicePrefix','Invoice number prefix',v.invoicePrefix || 'INV'), area('categories','Expense categories (one per line)',(v.categories || ['materials','tools','fuel','travel','subcontractors','other']).join('\n')), area('terms','Default client terms',v.terms), area('paymentInstructions','Invoice payment instructions',v.paymentInstructions), fileInput('logo','Business logo (optional)',v.logoPath));
  if (type === 'clients') fields.push(input('name','Client name',v.name,'text','required maxlength="120"'), input('email','Email',v.email,'email'), input('phone','Phone',v.phone,'tel'), area('address','Billing address',v.address), area('locations','Job locations (one per line)',v.locations), area('notes','Client notes',v.notes), input('followUpDate','Follow-up date',v.followUpDate,'date'), check('archived','Archive client',v.archived));
  if (type === 'workers') fields.push(input('name','Helper name',v.name,'text','required'), dollars('costRateCents','Labor cost / hour ($)',v.costRateCents), dollars('billRateCents','Bill rate / hour ($)',v.billRateCents), check('archived','Archive helper',v.archived));
  if (type === 'opportunities') fields.push(clientSelect(v.clientId), input('title','Future work',v.title,'text','required'), input('followUpDate','Follow-up date',v.followUpDate,'date'), area('notes','Conversation notes',v.notes), check('archived','Archive opportunity',v.archived));
  if (type === 'estimates') fields.push(clientSelect(v.clientId), input('title','Job title',v.title,'text','required'), area('location','Job location',v.location), input('expiresDate','Estimate valid through',v.expiresDate,'date'), dollars('discountCents','Fixed discount ($)',v.discountCents), input('overheadPercent','Overhead (%)',v.overheadPercent ?? state.settings.overheadPercent ?? 0,'number','min="0" max="1000" step="0.01"'), input('taxPercent','Sales tax (%)',v.taxPercent ?? state.settings.taxPercent ?? 0,'number','min="0" max="1000" step="0.01"'), area('terms','Client-visible terms',v.terms ?? state.settings.terms), area('notes','Internal notes (never printed)',v.notes));
  if (type === 'jobs') fields.push(select('status','Job status',['scheduled','in-progress','on-hold','completed','cancelled'].map(x => [x,x]),v.status), area('notes','Job notes',v.notes), area('lessons','Closeout lessons / future pricing',v.lessons));
  if (type === 'visits') fields.push(jobSelect(v.jobId), input('date','Visit date',v.date || day(),'date','required'), input('start','Start',v.start || '09:00','time','required'), input('end','End',v.end || '10:00','time','required'), `<fieldset class="wide"><legend>Assigned crew</legend>${[['owner','Owner'],...active('workers').map(w => [w.id,w.name])].map(([id,name]) => check('crew_'+id,name,(v.workerIds || ['owner']).includes(id))).join('')}</fieldset>`, area('notes','Visit notes',v.notes), check('overrideConflict','Allow conflicting assignment after reviewing schedule',v.overrideConflict));
  if (type === 'timeEntries') fields.push(jobSelect(v.jobId), select('workerId','Worker',[['owner','Owner'],...active('workers').map(w => [w.id,w.name])],v.workerId || 'owner'), input('date','Work date',v.date || day(),'date','required'), select('kind','Time type',[['work','Work'],['travel','Travel']],v.kind || 'work'), input('minutes','Duration (minutes)',v.minutes || 60,'number','min="1" max="10080" step="1" required'), input('miles','Miles (travel only)',v.miles || 0,'number','min="0" max="10000" step="0.1"'), area('notes','Notes',v.notes), check('confirmLong','Confirm session longer than 12 hours'));
  if (type === 'expenses') fields.push(input('merchant','Merchant',v.merchant), input('date','Purchase date',v.date || day(),'date','required'), dollars('amountCents','Receipt total ($)',v.amountCents), select('category','Expense category',(state.settings.categories || ['materials','tools','fuel','travel','subcontractors','other']).map(x => [x,x]),v.category || 'materials'), area('notes','Expense notes',v.notes), fileInput('receipt','Receipt photo',v.receiptPath));
  if (type === 'changes') fields.push(jobSelect(v.jobId), area('description','Client-visible change scope',v.description), dollars('priceCents','Contract price adjustment ($)',v.priceCents,true), dollars('costCents','Estimated direct cost adjustment ($)',v.costCents,true), select('costCategory','Cost adjustment category',['labor','materials','subcontractors','travel','other'].map(x=>[x,x]),v.costCategory || 'other'), input('minutes','Planned labor adjustment (minutes)',v.minutes || 0,'number','step="1" min="-10080"'), check('taxable','Taxable adjustment',v.taxable));
  if (type === 'payments') fields.push(jobSelect(v.jobId), dollars('amountCents','Amount received ($)',v.amountCents), input('date','Payment date',v.date || day(),'date','required'), select('method','Payment method',['Cash','Check','Bank transfer','Card (record only)','Other'].map(x => [x,x]),v.method || 'Cash'), input('reference','Reference / check number',v.reference));
  if (type === 'photos') fields.push(jobSelect(v.jobId), select('kind','Photo stage',['before','progress','after'].map(x => [x,x]),v.kind || 'before'), area('caption','Caption',v.caption), fileInput('photo','Job photo',v.path));
  if (type === 'decision') fields.push(select('status','Decision',[['accepted','Accepted'],['declined','Declined'],['expired','Expired']]), input('date','Decision date',day(),'date','required'), area('note','How was the decision received?'), fileInput('evidence','Evidence image (optional)'));
  if (type === 'approval') fields.push(input('date','Approval date',day(),'date','required'), area('note','How did the customer approve?'), fileInput('evidence','Approval evidence (optional)'));
  if (type === 'invoice') fields.push(input('date','Invoice date',day(),'date','required'), input('dueDate','Due date',day(),'date','required'), area('terms','Client-visible terms',v.document?.terms || state.settings.terms), ...(v.invoiceId ? [area('reason','Reason for replacing the existing invoice')] : []));
  $('#editor-fields').innerHTML = `<div class="fields">${fields.join('')}</div>${type === 'estimates' ? `<section id="scope-lines">${(v.lines || [{}]).map(l => lineFields(l)).join('')}</section><div class="actions">${btn('Add scope item','data-add-line')}${select('templateChoice','Add saved item',[['','Choose a reusable item'],...active('templates').map(t => [t.id,t.description])],'',false)}${btn('Copy saved item','data-add-template')}</div><div id="estimate-live"></div><p class="help">Markup = profit ÷ cost. Margin = profit ÷ revenue. Blank selling price uses suggested markup; an entered price overrides it.</p>` : ''}${type === 'templates' ? lineFields(v,true) + check('archived','Archive template',v.archived) : ''}${type === 'expenses' ? `<h3>Allocate this purchase</h3><p class="help">Leave empty to sort later. Add allocations for multiple jobs, customer-only costs, or business overhead. Amounts must match the receipt total.</p><div id="allocations">${(v.allocations || (v.jobId ? [{jobId:v.jobId,amountCents:v.amountCents || 0}] : [])).map(allocationFields).join('')}</div>${btn('Add allocation','data-add-allocation')}` : ''}`;
  $('#form-status').textContent = ''; $('#form-status').className = '';
  $('#save-record').disabled = false;
  $('#editor').showModal();
  updateEstimatePreview();
}
function readFields(container) {
  const result = {};
  container.querySelectorAll('input[name],select[name],textarea[name]').forEach(el => {
    if (el.type === 'file' || el.closest('.scope-line,.allocation') && !container.matches('.scope-line,.allocation')) return;
    result[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? el.value === '' ? null : el.name.endsWith('Cents') ? Math.round(Number(el.value) * 100) : Number(el.value) : el.value;
  });
  return result;
}
function readForm() {
  const p = readFields($('#editor-fields'));
  if (state.form.type === 'estimates') p.lines = [...document.querySelectorAll('.scope-line')].map(readFields);
  if (state.form.type === 'templates') Object.assign(p, readFields($('.scope-line')));
  if (state.form.type === 'expenses') p.allocations = [...document.querySelectorAll('.allocation')].map(readFields);
  if (state.form.type === 'visits') p.workerIds = Object.entries(p).filter(([key,value]) => key.startsWith('crew_') && value).map(([key]) => key.slice(5));
  if (state.form.type === 'settings') p.categories = p.categories.split('\n').map(s => s.trim()).filter(Boolean);
  return p;
}
function updateEstimatePreview() {
  if (state.form?.type !== 'estimates') return;
  try { const t = F.estimate(readForm()); $('#estimate-live').innerHTML = metrics([['Selling total',money(t.totalCents)],['Direct costs',money(t.directCents)],['Overhead',money(t.overheadCents)],['Projected profit',money(t.profitCents)],['Margin',t.marginPercent.toFixed(1)+'%'],['Markup',t.markupPercent.toFixed(1)+'%']]); }
  catch (err) { $('#estimate-live').textContent = err.message; }
}
async function saveForm(event) {
  event.preventDefault();
  const form = state.form;
  if (!form || $('#save-record').disabled) return;
  const status = $('#form-status');
  $('#save-record').disabled = true; status.className = ''; status.textContent = 'Saving…';
  try {
    const p = readForm();
    const files = { receipt: ['receipts','receiptPath'], photo:['photos','path'], logo:['logos','logoPath'], evidence:['evidence','evidencePath'] };
    for (const [key,[folder,field]] of Object.entries(files)) {
      const file = $(`[name="${key}"]`)?.files?.[0];
      if (file) {
        const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
        if (form.uploaded[key]?.fingerprint !== fingerprint) form.uploaded[key] = { fingerprint, path: await API.upload(file,folder,n => { status.textContent = `Uploading ${key}… ${n}%`; }) };
        p[field] = form.uploaded[key].path;
      } else if (form.original[field]) p[field] = form.original[field];
    }
    p.version = form.original.version || 0;
    if (form.original.supersedesId) p.supersedesId = form.original.supersedesId;
    let request = { action:'save', collection:form.type, id:form.id || undefined, payload:p };
    if (form.type === 'settings') request = { action:'settings',payload:p };
    if (form.type === 'payments') request = { action:'recordPayment',payload:p };
    if (form.type === 'decision') request = { action:'estimateDecision',id:form.original.id,payload:p };
    if (form.type === 'approval') request = { action:'approveChange',id:form.original.id,payload:p };
    if (form.type === 'invoice') request = { action:'issueInvoice',id:form.original.id,payload:{...p,replace:Boolean(form.original.invoiceId)} };
    const fingerprint = JSON.stringify(request);
    if (form.lastInput && form.lastInput !== fingerprint) form.requestId = crypto.randomUUID();
    form.lastInput = fingerprint;
    await API.command({ ...request, requestId:form.requestId });
    $('#editor').close(); state.form = null; notice('Saved.');
    // Clear reference caches so the next quick-add sees newly created records.
    state.data = {}; await load();
  } catch (err) { status.textContent = `${err.message} Your entries are still here; correct them or retry.`; status.className = 'error'; }
  finally { $('#save-record').disabled = false; }
}
async function transition(action,id,payload = {},collection) {
  if (!state.authorized) return;
  const request = {action,id,payload,collection,requestId:crypto.randomUUID()};
  notice('Saving…');
  try {
    const result = await API.command(request);
    notice('Saved.');
    if (action === 'convertJob') await navigate('Jobs',result.id);
    else await load();
  } catch (err) {
    notice(err.message,true);
    // Keep the exact request for a safe, idempotent retry after uncertain failures.
    state.retry = request;
    $('#notice').append(document.createTextNode(' '));
    const button = document.createElement('button'); button.textContent = 'Retry'; button.dataset.retry = '1'; $('#notice').append(button);
  }
}
function renderTimer() {
  const timer = state.timer; const bar = $('#timer-bar');
  bar.hidden = !timer?.startedAt;
  if (bar.hidden) return;
  const minutes = Math.max(0,Math.floor((Date.now()-Date.parse(timer.startedAt))/60000));
  bar.innerHTML = `<strong>${e(timer.kind)} timer · ${minutes} min</strong> · ${e(jobName(timer.jobId))} <span class="actions">${btn('Stop & save','data-timer="stop"')}${btn('Cancel timer','data-timer="cancel"')}</span>`;
}
setInterval(renderTimer,30000);
async function showImage(path) {
  const blob = await API.imageBlob(path); const url = URL.createObjectURL(blob);
  const dialog = document.createElement('dialog');
  const image = document.createElement('img'); image.src = url; image.alt = 'Private business attachment'; image.className = 'thumbnail';
  const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => dialog.close();
  dialog.append(image,close); document.body.append(dialog); dialog.addEventListener('close',()=>{URL.revokeObjectURL(url);dialog.remove();});dialog.showModal();
}
document.addEventListener('click',async event => {
  const target = event.target.closest('button,a');
  if (!target || !state.authorized) return;
  const d = target.dataset;
  try {
    if (d.view) await navigate(d.view);
    if (d.reload !== undefined) await load();
    if (d.client) await navigate('Clients',d.client);
    if (d.estimate) await navigate('Estimates',d.estimate);
    if (d.job) await navigate('Jobs',d.job);
    if (d.page) { state.page=Number(d.page);render(); }
    if (d.new) await edit(d.new,{}, {clientId:d.clientId || '',jobId:d.jobId || ''});
    if (d.edit) await edit(d.edit,find(d.edit,d.id));
    if (d.settings !== undefined) await edit('settings',state.settings);
    if (d.revise) { const original=find('estimates',d.revise);await edit('estimates',{...original,id:null,version:0,status:'draft',supersedesId:original.id},{newRevision:true}); }
    if (d.decision) await edit('decision',find('estimates',d.decision));
    if (d.approve) await edit('approval',find('changes',d.approve));
    if (d.invoice) await edit('invoice',find('jobs',d.invoice));
    if (d.action && confirm(d.action === 'issueEstimate' ? 'Issue this estimate? Its client document and pricing will be preserved. Further edits require a new revision.' : 'Create the job from this accepted estimate?')) { target.disabled=true;await transition(d.action,d.id,{date:day()}); }
    if (d.preview) {
      const record = find(d.preview,d.id);
      if (!record.document) throw new Error('Issue this estimate to create its fixed client document.');
      if (record.status === 'void' && !confirm('This invoice is void. Preview it for historical reference?')) return;
      await preview(record,record.jobId ? all('payments').filter(p=>p.jobId===record.jobId) : []);
    }
    if (d.void) { const reason=prompt('Why are you voiding this entry? It remains in the history.');if(reason) await transition('voidEntry',d.id,{reason},d.void); }
    if (d.image) await showImage(d.image);
    if (d.addLine !== undefined) { $('#scope-lines').insertAdjacentHTML('beforeend',lineFields());updateEstimatePreview(); }
    if (d.removeLine !== undefined && confirm('Remove this scope item?')) { target.closest('.scope-line').remove();updateEstimatePreview(); }
    if (d.addTemplate !== undefined) { const t=find('templates',$('[name="templateChoice"]').value);if(t){$('#scope-lines').insertAdjacentHTML('beforeend',lineFields(t));updateEstimatePreview();} }
    if (d.addAllocation !== undefined) $('#allocations').insertAdjacentHTML('beforeend',allocationFields());
    if (d.removeAllocation !== undefined) target.closest('.allocation').remove();
    if (d.calendarMode) { state.calendarMode=d.calendarMode;render(); }
    if (d.calendarStep) { const n=Number(d.calendarStep);if(state.calendarMode==='month'){state.calendarDate.setDate(1);state.calendarDate.setMonth(state.calendarDate.getMonth()+n);}else state.calendarDate.setDate(state.calendarDate.getDate()+n*7);render(); }
    if (d.calendarToday !== undefined) {state.calendarDate=new Date();render();}
    if (d.timer) {
      const payload=d.timer==='start'?{jobId:d.id,date:day(),kind:d.kind}:{[d.timer]:true};
      if(d.timer==='cancel' && !confirm('Discard this running timer?'))return;
      if(d.timer==='stop' && Date.now()-Date.parse(state.timer.startedAt)>12*3600000){if(!confirm('This timer exceeds 12 hours. Save the full duration?'))return;payload.confirmLong=true;}
      target.disabled=true;await transition('timer',undefined,payload);
    }
    if (d.retry) { target.disabled=true;try{await API.command(state.retry);notice('Saved.');await load();}catch(err){notice(err.message,true);} }
    if (d.export==='expenses') csv('business-expenses.csv',['Date','Merchant','Category','Amount USD','Allocation','Receipt path','Voided'],all('expenses').flatMap(x=>(x.allocations.length?x.allocations:[{amountCents:x.amountCents}]).map(a=>[x.date,x.merchant,x.category,(a.amountCents/100).toFixed(2),a.jobId?jobName(a.jobId):a.clientId?clientName(a.clientId):x.allocations.length?'Business overhead':'Unassigned',x.receiptPath,x.voided?'Yes':'No'])));
    if (d.export==='jobs') csv('business-job-costs.csv',['Job','Client','Status','Original cost USD','Revised cost USD','Actual cost USD','Pretax revenue USD','Profit USD','Collected USD','Estimated hours','Actual hours'],all('jobs').map(j=>{const r=report(j);return[j.title,clientName(j.clientId),j.status,...[r.originalCostCents,r.revisedCostCents,r.actualCostCents,r.revenueCents,r.profitCents,r.collectedCents].map(n=>(n/100).toFixed(2)),(r.estimatedMinutes/60).toFixed(2),(r.actualMinutes/60).toFixed(2)];}));
  } catch(err) { notice(err.message,true); }
  finally { target.disabled=false; }
});
$('#editor-form').addEventListener('submit',saveForm);
$('#editor-fields').addEventListener('input',updateEstimatePreview);
function closeEditor(event) { if ($('#save-record').disabled) { event?.preventDefault();return; } if(confirm('Close this form? Unsaved changes will be lost.')){$('#editor').close();state.form=null;}else event?.preventDefault(); }
$('#close-editor').onclick=closeEditor;$('#cancel-editor').onclick=closeEditor;$('#editor').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
$('#close-preview').onclick=()=>$('#preview').close();$('#print-document').onclick=()=>window.print();
$('#sign-in').onclick=async()=>{try{await signInWithPopup(API.auth,new GoogleAuthProvider());}catch(err){$('#gate-message').textContent=err.message;}};
$('#sign-out').onclick=()=>signOut(API.auth);
onAuthStateChanged(API.auth,async user=>{
  stopAccessWatch?.();stopAccessWatch=null;
  state.authorized=false;state.generation++;state.data={};state.settings={};state.timer=null;
  const generation=state.generation;
  $('#content').replaceChildren();$('#timer-bar').hidden=true;
  $('#app').hidden=true;$('#gate').hidden=false;$('#sign-in').hidden=Boolean(user);
  $('#editor').close();$('#preview').close();$('#document').replaceChildren();
  if(!user){$('#gate-message').textContent='Sign in to your private business workspace.';return;}
  try {
    const allowed=await API.session(user);
    if(generation!==state.generation)return;
    if(!allowed){$('#gate-message').textContent='Your account needs Handyman Business approval. Ask the site administrator to enable it.';return;}
    state.authorized=true;$('#gate').hidden=true;$('#app').hidden=false;
    stopAccessWatch=API.watchAccess?.(user.uid,allowed=>{if(!allowed){state.authorized=false;state.generation++;state.data={};state.timer=null;$('#app').hidden=true;$('#gate').hidden=false;$('#gate-message').textContent='Business access was revoked. Contact the site administrator.';$('#content').replaceChildren();document.querySelectorAll('dialog').forEach(d=>d.close());$('#document').replaceChildren();}});
    await navigate('Overview');
  } catch(err){$('#gate-message').textContent=err.message;}
});
window.addEventListener('beforeunload',event=>{if(state.form){event.preventDefault();event.returnValue='';}});
