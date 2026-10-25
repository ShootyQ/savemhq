# Personal Project Billing

`billing.html` is the SavemHQ administrator's separate workspace for paid project work. It is linked as **My project billing** from The Desk and requires the existing administrator Google account. No Handyman Business or additional section approval is needed.

## Workflow

1. Enter your billing name, contact details, payment instructions, invoice prefix, and optional default terms in Settings. No sample data is created in production.
2. Add a customer's contact details and billing address.
3. Create a project with its name, client-visible scope, fixed USD fee, status, optional target date, and private notes.
4. Record deposits or payments manually when received. Create an invoice directly from the project, preview it, and print/save PDF to send yourself.
5. If the project fee or scope changes after invoicing, the original invoice stays unchanged and the project shows a replacement notice. Issue a replacement with a reason; the old invoice is marked void, and all project payments carry forward.

Project status is independent from payment status: completing a project does not mark it paid. Customers are archived rather than deleted. A project's customer cannot be changed after a deposit or invoice exists. Mistaken payments are voided with a reason and retained in history. The dashboard shows active project fees, outstanding issued invoice balances, and recorded collections. This portal does not add sales tax or process payments online.

There are no estimating stages, staffing schedules, expenses, time tracking, or profit calculators in this interface. Personal billing is not projected into handyman tasks or mixed with handyman business records.

## Data and security

Records live under `projectBilling/{adminUid}` in settings, clients, jobs (displayed as Projects), invoices, payments, activity, and server-only request records. Firestore reads require both the administrator email claim and the matching owner UID. Direct browser writes are denied.

The `projectBillingCommand` callable checks the administrator's authenticated email, then reuses the tested billing service in a restricted mode with a separate namespace and action allowlist. There is no client-selectable namespace or owner UID. The administrator's own approval record must remain approved and match the administrator email. Normal business accounts cannot invoke the simplified project action or read these records.

Issuing invoices and recording payments use the same transaction, sequential numbering, request-id deduplication, cent arithmetic, immutable invoice snapshots, and client-document whitelist as the handyman portal. Project edits use version checks to reject stale changes. Private customer/project notes never enter invoice documents. The namespaces have independent customer lists, settings, and invoice sequences.

## Validation and rollout

```bash
npm --prefix functions ci
npm --prefix functions run test:business
npm --prefix functions run test:business:rules
npm --prefix functions run test:billing:browser
```

The billing browser test uses the real UI and backend service with a local isolated store and mocked Firebase transport. It verifies the admin-only gate, fixed-fee flow, deposits, invoice/PDF privacy, replacement invoices, retained payment balance, mobile layout, and failed-form input retention. The emulator suite separately verifies the actual admin-only Firestore rules and prevents non-admin/cross-owner reads and browser writes. Generated sample invoices and screenshots are under `/tmp/billing-*`.

Deploy the new backend and rules before publishing the website:

```bash
npx --prefix functions firebase deploy --project savemhq --only "firestore:rules,functions:projectBillingCommand"
```

No new composite indexes or Storage rules are needed. Merge/publish the website through the existing GitHub Pages workflow after Firebase succeeds. Then sign in as administrator, open **My project billing**, and enter your real billing details. Deployment and a real customer invoice check are separate from local validation.
