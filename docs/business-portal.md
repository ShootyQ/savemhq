# Handyman Business Portal

`business.html` is an owner-operated, fixed-price job workspace linked from The Desk. It uses the existing Google login but requires the separate **Handyman Business** approval. Even the site administrator must have the explicit section enabled on their own approved record. Helpers and customers do not receive accounts.

## Local development and validation

Use Node 20, Java 21, and Python 3. From the repository:

```bash
npm --prefix functions ci
npm --prefix functions run lint
npm --prefix functions run test:business
npm --prefix functions run test:business:rules
npm --prefix functions run test:rules
npm --prefix functions run test:business:browser
```

The browser suite uses Chromium at `/usr/bin/chromium`; set `CHROMIUM_PATH` for another installation. It exercises the real portal and service using an isolated transactional test store, replacing only Firebase transport/auth. It does not prove production OAuth or deployed connectivity. The emulator suite independently tests real Firestore transactions and Firestore/Storage authorization. It uses a `demo-business` project and refuses to run without the Firestore emulator. Emulator downloads require `storage.googleapis.com`. The browser suite generates screenshots and Letter/A4 PDFs under `/tmp/business-*`.

When the default home is not writable, set `XDG_CONFIG_HOME` and `FIREBASE_EMULATORS_PATH` to writable directories. The prepared cloud instance has Node 20 at `/workspace/.savemhq-tools/node_modules/node/bin` and emulator caches at `/workspace/.cache/firebase/emulators`.

For normal static development:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

The static site uses the configured Firebase backend. For an entirely local backend, start the Auth, Firestore, Storage, and Functions emulators with the repository Firebase configuration, then open the portal with `?emulators=1` on localhost. Use only emulator users/data. This opt-in never applies on the production hostname. Firebase Google popup login in production requires an authorized domain.

## Pilot workflow

1. Approve the business owner's account in `admin.html`; select Handyman Business.
2. Enter real business branding, contact details, timezone, costing rates, overhead, tax defaults, terms, and payment instructions in Settings. No fictional business data is seeded in production.
3. Add a client, billing/job addresses, and an optional follow-up. Add helper rates and common estimate templates.
4. Build an estimate. Blank selling prices use markup; entered prices override it. Confirm the totals, issue, and inspect the client-only print preview. Print or save PDF and send it yourself.
5. Record the customer's decision and any approval evidence. Create the accepted estimate's job, schedule visits, and assign helpers.
6. Record work/travel time, mileage, purchases, receipt allocations, before/progress/after photos, and approved changes. A receipt may remain unassigned for later sorting. Costs assigned only to a client or overhead do not count toward a job.
7. Record deposits, issue the final invoice, and inspect the balance. Changes approved after invoicing flag the job for a traceable replacement; existing invoices never silently change. Record final payment manually.
8. Complete the job and compare original estimate, revised forecast, and actual costs. Enter lessons; deliberately update reusable templates rather than rewriting history. Export CSV if needed.

Run the first real job alongside the owner's current records before relying on the portal as the sole business record.

## Financial conventions

- USD integer cents; time in integer minutes. Labor costs round once per time entry. Material quantity × unit cost rounds to cents.
- Estimated direct costs include owner/helper labor, materials, subcontractors, travel, and other costs. Overhead is a percentage of direct costs, both in the estimate and actual job-cost report.
- Markup-assisted line pricing uses direct cost; the estimate summary includes overhead, so its final markup/margin can differ from the line's suggested markup.
- Fixed discounts are apportioned across selling lines with an exact largest-remainder cent allocation. Tax applies to the discounted taxable portion. Tax is excluded from job profit.
- Approved changes adjust the fixed contract and forecast, with a chosen cost category. Actual purchases and overtime do not automatically increase the invoice.
- Actual profit is provisional until all costs are captured. Collections are separate; deposits and payments belong to the job and survive invoice replacement. Overpayments appear as negative balances.
- Mileage is a separate cost allowance. Do not also allocate the same fuel cost to the job. Overhead allocations are disclosed separately from job costs; don't count the same business overhead receipt twice.
- Issued estimates/invoices snapshot branding, customer details, terms, and prices. Template, helper-rate, client, and settings edits do not rewrite old documents or time entries.

## Architecture and permissions

Business data is isolated under `businesses/{ownerUid}`. Collection reads require an approved owner with the business section; all direct client writes are denied. The authenticated `businessCommand` callable validates every write, linked record, financial transition, and request ID. Approval is rechecked inside each transaction. Transactions allocate sequential document numbers, preserve revisions, deduplicate conversions, and atomically record activity. Request IDs make uncertain retries idempotent. Draft edits use version checks to reject stale writes.

Historical queries fetch bounded 100-record Firestore pages; lists render 25 records per page. Each view loads its own dependencies and no persistent background data listeners; a single approval listener clears the portal when access is revoked. Full reports load all relevant pages to avoid silently reporting partial totals. The two filtered server queries use Firestore's standard single-field indexes, so `firestore.indexes.json` deliberately declares no composite indexes.

Private images live under `businesses/{ownerUid}/{receipts|photos|logos|evidence}`. Only the approved owner can upload/read. Images are immutable, at most 10 MB, and restricted to JPEG/PNG/WebP MIME types. The browser retrieves blobs through authenticated Storage requests; it never creates public download links. Failed saves retain form input and successfully uploaded image paths for retry. An upload abandoned before saving can remain unreferenced; automated retention/cleanup is not included.

`functions/business/finance.js` and `js/business/finance.js` must remain identical; the test suite enforces this. `documents.js` renders only a fixed client-facing whitelist and escapes all text. Print styles exclude application UI. Stripe is a disabled server-side provider boundary only: there is no checkout, credential, webhook, account connection, or live payment processing. Enabling it later requires verified webhooks, idempotent external payment IDs, provider-side refund policy, and explicit account setup.

## Production rollout — separate action

No production deployment is performed by the implementation or tests.

1. Run all checks, including existing Desk regressions and emulator tests.
2. Deploy Firestore rules/indexes, Storage rules, and the `businessCommand` Function before publishing the portal and Desk link. Use the repository's established static hosting deployment; do not accidentally introduce a second hosting destination.
3. If bucket CORS needs updating, apply `storage.cors.json` using the existing documented Cloud Storage procedure. This requires a separate production action; the file now includes localhost port 8000 for authenticated image development.
4. Approve the intended owner and validate sign-in, private upload/download, one estimate/job/invoice, and payment balance using that account.
5. Check Function errors in Firebase logs during the pilot. Validate mobile capture and actual printer/browser output with the owner. No customer messages or payments are sent automatically.

Keep previous hosting releases available for rollback. Retain business data and financial history if hiding the portal. Removing the business approval revokes subsequent data requests and callable operations.
