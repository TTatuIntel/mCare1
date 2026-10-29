# MATENDO × mCare — UNIFIED HEALTHCARE BRIDGE
## Single Source of Implementation Requirements, Architecture, Integration Contract and Acceptance Plan

**Document version:** 2.0 — 27 October 2026  
**Applies to:** Matendo (PHP/MySQL) and mCare (React/TypeScript/Supabase/PostgreSQL)  
**Document status:** **Implementation specification and verified static repository review — NOT a production deployment certificate**  
**Owner:** Joint Matendo/mCare engineering, operations, clinical governance and finance teams  
**Use:** Give this *one file* to the implementing AI agent or engineering team in **both** repositories. Keep a copy under the same document name in each repo, with app-specific `AGENTS.md` linking to it. Existing historical documentation may be archived only after requirements are reconciled; do not indiscriminately delete other operational or legal records.

> **Primary outcome:** A person may start in Matendo or mCare, book a single home visit or arrange ongoing care, and receive one coherent experience. Matendo safely manages the service marketplace and money; mCare safely manages longitudinal clinical care. Both show the same permitted state with no duplicate visits, conflicting payments, mismatched patients or lost records.

---

## 0. How to read this file — evidence versus intended implementation

Legend: **EXISTS IN ARCHIVE** means source code or a migration is present in the uploaded 23 October archive; **DOCUMENTED TEST** means the repository's own documentation reports a test run, not that it was re-executed now; **UPGRADE** means required engineering work; **EXTERNAL DEPENDENCY** means a third-party, governance or production configuration step remains.

### Files actually reviewed

- Supplied `PROJECT_CONTEXT.md`: an intentionally unverified project-context template; it is not proof of any implementation.
- Supplied `13-Home-Visits-Patient-Arm.md` and `14-Matendo-mCare-Bridge.md`, including their reuploaded versions.
- Matendo archive **`Matendo-health-dev (2).zip`** nested inside the uploaded October archive; the older `(1)` archive also exists but is **not** used as the newest baseline. Main implementation: `config/home_visits.php`, `config/patient_requests.php`, `config/home_visit_panel.php`, `config/home_visit_clinician.php`, `config/home_visit_money.php`, `config/home_visit_safety.php`, `config/home_visit_selfie.php`, `config/care_packages.php`, `config/mcare_bridge.php`, `api/broker/v1.php`, `cron/home_visits_sweep.php`, migrations `2026_127_home_visits.sql` and `2026_128_care_packages.sql`.
- mCare archive **`mCare1-main (2).zip`** from the same nested folder. Main implementation: `supabase/migrations/0017_home_visits.sql`, `0018_care_packages.sql`, `supabase/functions/_shared/matendo.mjs`, `supabase/functions/matendo-bridge/index.ts`, `src/patient/homeVisits.tsx`, `src/doctor/HomeVisitRecord.tsx`, `supabase/tests/matendo.test.mjs`, and `AGENTS.md` §15.
- The archive itself contains a more complete care-package specification in `Matendo-health-dev/docs/pilot/12-care-packages-and-special-circumstances.md`. This feature was **missing from the two standalone bridge documents** and must not be lost during consolidation.

**What was checked for this document:** file structure, migrations, interfaces, documented workflows, selected implementation branches and syntax. `php -l` succeeded on five core Matendo files and `node --check` succeeded on the shared mCare bridge module and bridge test script. **No connected MySQL/Supabase deployment, payment provider, SMS, face-match provider, email, background workers or full E2E journey was run in this review.**

### Existing functionality worth preserving

| Capability | Archive evidence | Treatment |
|---|---|---|
| Matendo home visit panel, quote, matching, safety, payment handling | `2026_127`, home-visit classes and screens | **Preserve and harden** |
| One-way/reverse bridge, signed events, snapshots, nonces, outbox | `config/mcare_bridge.php`, `matendo.mjs`, `0017` | **Extend, do not replace wholesale** |
| mCare patient booking, visit records, sign-off, clinician access | `homeVisits.tsx`, `HomeVisitRecord.tsx`, `0017` | **Preserve and refine** |
| Packages, team rota, shift payments, handovers, dose logs | Matendo `2026_128`, mCare `0018`, related source | **First-class part of bridge v2** |
| Matendo → mCare events | `visit.updated`, `visit.intake`, `clinician.enrolled`, `package.updated` | **Keep and version** |
| mCare → Matendo actions | Booking, package actions, `record_signed`, `handover_recorded` | **Keep and add delivery safeguards** |
| Existing automated checks | mCare `AGENTS.md` records 97 bridge checks passed as of 19 October, after the earlier 64; existing Matendo tests also present | **Historical evidence only; rerun against the final repositories and production-like staging** |

**Known incompleteness from source documentation:** hosted mCare Edge Function/prod secrets not yet validated; manual Mobile Money transaction verification remains; automatic face matching remains provider-dependent with manual review; clinician push notifications remain incomplete. These are **not** marked delivered by this specification.

### Non-negotiable architecture decisions

1. **Two separate databases.** Do not merge Matendo/MySQL and mCare/PostgreSQL or add direct cross-database application queries.
2. **One owner for each business fact.** Matendo owns dispatch, fees, debt, collection, payout, safety and scheduling. mCare owns clinical notes, readings, care plans, medications, reports and signed clinical history.
3. **No writes to the old facility financial workflow** from patient-home-care flows (`shifts`, `billing_lines`, facility `payments` and `invoices` remain isolated unless explicitly reconciled in a reviewed migration).
4. **Backend-to-backend communication only** for private APIs; no bridge secret, privileged key or clinical payload in browser storage.
5. **User actions are simple and consistent** on mobile, tablet and web, with the same underlying authorization and state rules.
6. **Fail safely:** payment, safety, patient identity and record access must not be bypassed when the other system is offline.
7. **Retain contracts while upgrading:** incremental, additive, versioned changes; migrate existing records; do not silently break working v1 clients.

---

## 1. Product experience and clear division of responsibility

### 1.1 Recommended logical architecture

```text
        mCare Patient UI                         Matendo Patient UI
     clinical records + booking                 booking + payments
                 |                                     |
                 v                                     v
       mCare Auth + API Gateway                  Matendo Web/API
                 |                                     |
       mCare Bridge Adapter <---signed API/events---> Matendo Bridge Adapter
        (Supabase Edge Function)                      (PHP backend)
                 |                                     |
       PostgreSQL + RLS + Outbox               MySQL + Outbox + Ledger
          CLINICAL AUTHORITY                 MARKETPLACE / MONEY AUTHORITY
                 |                                     |
          Doctor/Care Team UI                   Clinician App / Ops UI
     notes, readings, care plans               shifts, PIN, safety, money
```

**Bridge is an orchestration boundary, not a third clinical database.** It may hold identifiers, delivery metadata, event status, immutable audit entries and a **minimum necessary** copy of the other system's state. It must not become a duplicate master patient record or accounting ledger.

### 1.2 Single source of truth matrix

| Information | Authoritative system | Other-system projection | Restriction |
|---|---|---|---|
| Matendo panel verification, APL dates, clinician availability | Matendo | Verified clinician reference and permitted card | mCare may not independently mark Matendo panel eligibility |
| Account authentication | Each native app | Explicit account linking assertion | Do not share passwords, tokens or unrestricted sessions |
| Person/recipient Health ID | Matendo issues existing `MH-XXXXXX` | mCare stores mapped ID | Link only after proof of identity/authority |
| Clinical patient record, allergies, diagnosis, vital readings | mCare | No clinical mirror in Matendo | Exception: consented, minimum intake originating in Matendo |
| Visit and package lifecycle, matching, travel, ETA, rota | Matendo | Sequenced read-only projection in mCare | No independent status editing in mCare |
| Quote, fees, charges, transfer confirmation, refund, payout | Matendo | Patient-facing amount/instructions/status only | Do not create an mCare money ledger |
| Visit note, signed record, handover, care-plan review | mCare | Signed/recorded **attestation** only | Matendo receives status/reference, not note text |
| PIN, selfie, SOS and responder actions | Matendo | Limited UI projection where strictly needed | Never put PIN in logs, analytics or durable generic notification messages |
| Consent to share clinical intake and caregiver permissions | mCare when collected there; Matendo when collected there | Purpose-limited consent receipt, not unrestricted sharing | Withdrawal/revocation propagated |
| Audit of actions | Both systems locally | Correlation ID and event outcome | No single app may edit the other's logs |

### 1.3 The UX users should see

**mCare patient:** `Home` → `Visits` → **Home care** (single visits and ongoing packages), `Health` (records and signed reports), notifications. A visit card contains one current status, approved clinician identity, ETA, arrival safety instructions, payment guidance, and a clear next action. The package card contains team, shift calendar, next review, next payment period, handover summaries and report access.

**Matendo patient:** identical service facts and controls, with a contextual **“View health record in mCare”** handoff. The link must use a short-lived, audience-limited server-issued link / authorization handoff, never expose a patient ID as authorization. If mCare is not configured, display an explicit **“Clinical record not linked yet”** state rather than a broken link.

**Clinician:** Matendo for accept/travel/check-in/selfie/safety/checkout and shifts; **“Document in mCare”** opens only an authorized visit/shift record. If they cannot sign in or lack access, show the actual missing prerequisite and provide a support/retry path; no artificial “doctor” privilege for a nurse or another cadre.

**Operations:** Matendo is the command centre for matching, verified payments, unmatched shifts, safety, disputes, refunds and payouts. mCare has a **Bridge Health / Access** administration view for failed sync, dangling mappings, clinical sign-off status and access/audit events. Neither console allows editing the other application's master data directly.

---

## 2. Roles, identity, patient linking and consent

### 2.1 Effective permissions (server enforced)

| Actor | May do | May not do |
|---|---|---|
| Patient | Book/pay/track for self, view own clinical information and signed record, confirm/report | Approve own clinician; alter verified payment or signed note |
| Verified authorized caregiver/booker | Book/manage specific delegated recipient and agreed practical updates | Gain blanket access to recipient's health record by knowing a phone or Health ID |
| Accepted verified clinician | Execute their assigned visit/shift; read necessary clinical data during authorized window; document work | Access unrelated patients; impersonate another clinician; release their own payout |
| Medical officer assessing package | Conduct, document and clinically assess, approve/decline/review within professional permissions | Privately change a quote, fabricate a payment, override operational safety |
| Matendo operations | Review payment evidence, dispatch/safety exceptions, refund/payout workflow, clinician verification | Modify mCare readings or clinical findings |
| Matendo finance | Reconcile collections/fees/payouts/refunds with maker-checker controls | Read clinical notes, change identity/selfie confirmation |
| mCare clinical administrator | Manage patient permissions, clinical records/access audits according to role | Change Matendo ledger or dispatch status |
| Bridge service account | Execute strict allowlisted signed calls and minimal DB routines | Arbitrary user impersonation or database-wide client access |

**UPGRADE — identity linking:** the archive sometimes finds mCare bookers by email and auto-links people by Health ID or verified phone. A matching phone/email is **useful discovery evidence, not sufficient authority for access to health information** (families may share contact information; accounts may have legacy/stale emails). Do **not** promote a discovered match to permission without a second system's verified identity and a one-time linking challenge or authenticated consent. Retain existing IDs but add a linking proof state: `suggested → challenge_pending → verified → active → revoked/contested`.

**UPGRADE — family relationships:** separate (1) **may book/pay**, (2) **may receive logistics/status updates**, and (3) **may read clinical data**. Independent explicit grants, scope, effective dates and revocation. For children/incapacitated adults, record legal/clinical consent basis, authorized guardian and required presence; do not assume next-of-kin declaration alone proves legal authority.

**UPGRADE — managed recipients:** existing mCare `createManaged()` provisions hidden authentication users for dependents. Assess replacing that pattern with a durable dependent/recipient identity without a password or login, or harden the current approach while migrating in stages. Never expose synthetic email accounts or allow self-service password recovery to claim a dependent's chart accidentally.

**UPGRADE — clinicians:** archive `clinician.enrolled` maps an invite to a mCare doctor account using email. Support cadre-specific clinical roles and professional scope with verified identity binding, not automatic privileges solely because the email matches. A nurse belongs to a nurse/home-care role unless an independently validated doctor role exists. Revocation/expiry on Matendo must immediately invalidate new assignments and access to clinical records.

### 2.2 Identifier and linking contract

| ID | Example/owner | Requirements |
|---|---|---|
| Visit | `HV-XXXXXX`, Matendo | Globally unique per Matendo deployment; immutable; mCare unique constraint |
| Care package | `CP-XXXXXX`, Matendo | Stable while plan exists, even when paused/ended |
| Care shift | `CS-XXXXXXX`, Matendo | Unique per shift and cross-reference to package |
| Health ID | `MH-XXXXXX`, Matendo | Display identifier **not authentication proof**; collisions checked atomically |
| mCare patient/profile ID | UUID, mCare | Never reused or inferred from names/phone alone |
| Clinician ref | existing `mtc_` reference, Matendo | Treat as opaque, stable mapping; **must not change when bridge HMAC secret rotates** |
| Command/idempotency | UUID/ULID, originating side | Unique per user intention; persisted on retries; never create duplicates |
| Correlation/trace ID | UUID/ULID, initiator | Included in events and logs, excluding PII |

**Important observed design issue:** `McareBridge::clinicianRef()` derives the existing `mtc_` ref from the bridge secret. **UPGRADE:** persist an immutable opaque clinician external reference in Matendo and a mapping to the old derived ref. Maintain backwards-compatible aliases; rotate signing keys independently from identifiers. Do not retroactively invalidate clinician links or historical signatures when rotating secrets.

### 2.3 Consent events

Record `consent_id`, `subject_id`, `grantee`, `purpose`, `scope`, `basis`, `version`, `captured_by`, `timestamp`, `expires_at`, `revoked_at` and audit correlation. Relevant purposes: visit intake transfer, shared clinical access, caregiver management, on-site contact and safety communication, selfie/biometric verification, follow-up information. Make decline and revoke understandable; revoke prospective access promptly and retain only legally required safety/accounting evidence.

---

## 3. End-to-end patient journey: one-off home visit

1. **Choose recipient.** `For me / For someone I look after`; load existing people; authenticated caregiver grant checked; do not create by name matching alone. Confirm age/sex details only as necessary.
2. **Choose care.** Approved cadre and clinician-accepted fee option. Show supported region, times, clinician availability and first-visit daylight rules. Do not let an urgent emergency enter routine dispatch: show locally approved emergency directions and emergency contact guidance instead.
3. **Enter request.** Time, map pin, landmark and on-site contact; optional typed or voice description in **mCare** when booking through mCare. Explain clearly which system receives which data.
4. **Verify caller.** Phone OTP bound to the account and booking intention, with rate limits, timeout and test/prod separation. A family payer may differ from patient, booker and on-site person.
5. **Quote.** Matendo calculates, validates and returns a short-lived signed/opaque `quote_id` plus expiry, breakdown, currency, patient-friendly cancellation terms and accepted fee option. Do not trust `quoted_total` supplied by UI as the price authority.
6. **Create.** The initiating system uses a durable **idempotency key**. Matendo atomically creates the visit and returns the immutable `HV` reference; mCare stores a pending local cross-reference and reconciles any ambiguous response. One tap = one booking even with browser retries.
7. **Pay.** Matendo presents valid Mobile Money instructions. A transaction ID entered by a user means **pending verification**, not paid. Dispatch begins only after verified settlement and fraud/duplicate reference checks.
8. **Match.** Matendo dispatches to APL-verified, approved and currently eligible clinicians, checks blocks/safety and applies fee/radius rules. Patient sees accepted clinician card; detailed patient health context becomes visible only to the assigned clinician.
9. **Travel and identity.** Matendo sends ETA; patient checks approved photo; arrival PIN and identity selfie flow control check-in. A mismatch pauses access and settlement immediately.
10. **Record clinical care.** The accepted clinician opens mCare with a scoped session, reviews permitted history, enters observations/visit note/recommendations and signs. A signed note is immutable, with **addenda** rather than silent edits.
11. **Checkout / confirmation.** Matendo records checkout and visit confirmation; a late or missing patient confirmation does not itself prove clinician identity. Identity review and any disputes must be resolved according to the payout gate.
12. **Settle.** Release clinician earnings only when payment is verified, attendance and identity rules pass, applicable patient confirmation/timeout and clinical signing gates pass, and no active safety hold exists. Show a clear **“Payment held — awaiting [reason]”** explanation to authorized users.
13. **Follow-up.** Signed report and permitted observations appear in mCare; Matendo shows only `record signed`, completion and logistics; patient can rebook approved same clinician where available.

### Visit state machines (Matendo authority)

```text
Booking:  local_draft → awaiting_payment → open → accepted → on_the_way
          → checked_in → checked_out → confirmed
Side outcomes: failed_creation, expired, cancelled, declined, transferred,
               died, safety_exit, no_access, disputed (overlay)
Payment:  unpaid → pending_verification → held → released
                     \→ rejected/correction_required
          held → refund_due → refunded    |    held → disputed
Clinical: not_open → access_granted → draft → signed → addendum (if required)
```

Only Matendo changes booking/payment state. Only mCare changes clinical state. Use validated transitions, transaction locking and explicit reason codes for exceptions. **Do not force every operational event into a single status enum:** disputes, safety holds and reconciliation exceptions are independently auditable flags/cases.

### Existing business options to retain unless approved for change

- Clinician-accepted fee options published in Matendo; no hidden auto-tariffs imposed after commitment.
- Radius-based matching and gradual widening, with a stable quote after payment.
- First visits limited to configured staffed/daylight hours, 4-digit PIN with a 5-attempt lockout, SMS for on-site contact, selfie and manual identity review fallback.
- Rebooking first refusal, patient/clinician two-way blocks, ops late-ETA alerts, safety timer and SOS.
- Payment allocation and cancellation rules use Matendo's existing `HomeVisitMoney::resolve()`; no second settlement calculator is implemented in mCare.

**UPGRADE:** never mark visits as confirmed when there is a safety/identity dispute; the documented 24-hour auto-confirm can only close an uncontested attendance acknowledgment and must not override required identity, clinical record or finance controls.

---

## 4. Ongoing care packages — fully integrated bridge, not a separate app

This requirement is in the *newer project archive* even though it was absent from the two standalone MDs. Preserve Matendo migration `2026_128` and mCare migration `0018`.

### 4.1 Package options and lifecycle

| Package | Service | Scheduling owner | Clinical owner |
|---|---|---|---|
| Round-the-clock | Day and night 12-hour shifts | Matendo | mCare |
| Days only / nights only | Regular 12-hour shifts | Matendo | mCare |
| Live-in | Approved multi-day rotation with rest and welfare | Matendo | mCare |
| Recurring visits | Scheduled shorter visits for a specified purpose | Matendo | mCare |

**Required workflow:** package inquiry → recipient/consent/special circumstances → estimate → doctor assessment or qualifying recent assessment → clinical care plan and approval → package request accepted → first payment verified → care team assigned → rota/shifts confirmed → check-in/out plus daily clinical handovers → periodic doctor review → reminders and next-week payment → continue/pause/modify/end/refund.

**Single package state:** `assessment → awaiting_payment → active ↔ paused → ended`; valid alternative outcomes `not_approved`, `cancelled`. mCare receives the authoritative full `package.updated` snapshot and `seq`. Package status **must not** be independently inferred from mCare screens or a single shift.

### 4.2 Mandatory doctor assessment and reviews

- Existing source design: assessment by a medical officer, qualifying assessment within the previous 14 days where valid, review normally every 28 days (14 for live-in), with an overdue review intervention. Keep these **configurable clinical governance policies**, not universal medical guidance.
- Approval should require an actual, signed assessment/care plan in mCare and a Matendo decision by an authorized professional. Add `assessment_signed`/`plan_approved` attestations and a safe pending state if mCare cannot be reached; no fabricated approval.
- The doctor specifies care goals, authorized clinical tasks, medications and safety escalation as appropriate. Operations cannot edit clinical instructions.
- For unexpected transfer, refusal, hospital admission, death or safety exit, preserve clinical events with timestamps and safe closure; do not delete history or expose diagnosis to Matendo.

### 4.3 Care team and shifts

- Matendo owns invitations, availability, shift assignment, working-time safeguards, rest, replacement, on-way, check-in, selfie verification, handover gate, late/absence alerts and financial accounting.
- mCare owns clinical sharing for **only assigned, eligible clinicians** while applicable access windows run. The snapshot's existing `access` list must be validated server-side against current Matendo assignment **and effective time**; do not treat stale projections as indefinite access.
- Clinician sees upcoming shifts, permitted patient care plan, previous handover, tasks, medications, and a clear **Record handover** action. Administrative dispatch/reassignment stays in Matendo.
- Each shift has its own `CS` reference, attendance/identity checks and handover attestation. Replacements cannot inherit an outgoing clinician's session or permissions.
- mCare `care_handover` saves a non-editable signed progress entry; **`handover_recorded`** travels reliably to Matendo with `shift_ref`, author reference, note reference, signed timestamp and idempotency key, **not** the clinical narrative.
- `care_dose_given` and `dose_given_guard` already indicate a protected medication-administration record. Add strict medication orders, dose/time/performer validation, duplicate-dose prevention, corrections by auditable reversal/addendum rather than deletion, clinical escalation for potential error and least-privilege visibility. Do not automate prescribing or authorize a dose using AI.

### 4.4 Package financial safeguards

- Keep week-by-week prepaid periods and one billable period per package (`care_package_payments` unique by period in existing schema).
- Calculate from the actual shift snapshot and clinician-selected rates, with frozen quote components; respect package changes by **future** adjustment or credit entry, not rewriting a settled past period.
- No shift in an unpaid period except an approved, time-limited and auditable ops grace rule; never abruptly abandon an existing patient because of an overdue payment — escalate for safe continuity and care transition.
- Reconcile extended relief time, missed shifts, replacement, pause, hospital admission and end with the existing Matendo policy; no duplicate charging of overlapping minutes.
- A payout is gated by verified collection, completed attendance, identity, handover and lack of active dispute/safety hold, with exception resolution logged.

---

## 5. Explicit Matendo ↔ mCare API and event contract

### 5.1 Keep existing v1 names, add versioning

**Matendo → mCare** existing events: `visit.updated`, `visit.intake`, `clinician.enrolled`, `package.updated`.  
**mCare → Matendo** existing attestations: `record_signed`, `handover_recorded`, `link_refs`.  
**Person through mCare server → Matendo** existing actions: `catalogue`, `quote`, `book`, phone OTP, `paid`, `cancel_terms`, `cancel`, `confirm`, `not_the_person`, `text_pin`, `report`, `block`, `status`, `clinicians_for_rebook`; care: `package_options`, `package_estimate`, `package_request`, `package_status`, `package_pay`, `package_text_payer`, `package_pause`, `package_resume`, `package_end`, `package_remove_member`, `shift_dispute`, `shift_not_the_person`.

**Implementation rule:** build an adapter accepting existing action bodies while introducing an explicit protocol version (`2`) and envelope. Avoid a flag day when one service deploys earlier.

### 5.2 Versioned event envelope (proposed v2)

```json
{
  "schema_version": 2,
  "event_id": "unique-immutable-event-id",
  "event_type": "visit.updated",
  "origin": "matendo",
  "aggregate_type": "visit",
  "aggregate_ref": "HV-EXAMPLE",
  "aggregate_seq": 19,
  "occurred_at": "2026-10-27T11:00:00Z",
  "correlation_id": "trace-id",
  "causation_id": "command-or-previous-event-id",
  "idempotency_key": "unique-operation-id",
  "data": { "status": "on_the_way", "eta_at": "2026-10-27T11:25:00Z" }
}
```

*Illustrative only — identifiers above are examples, not existing visits.*

- Treat `schema_version` as required for new v2; retain v1 adapter for legacy `{event, data}`.
- Server-generated `aggregate_seq` must be **monotonically increasing per visit/package within a DB transaction**. The current Matendo source uses millisecond time for visit snapshot `seq`; upgrade to an authoritative counter/DB revision because timestamp collisions and clock skew can misorder state.
- `event_id` is unique globally in the integration; `idempotency_key` identifies the business command; both must be persisted.
- Sensitive voice/text and PIN are **not** placed in generic event envelopes or logs. `visit.intake` is an exceptional consented, purpose-limited encrypted exchange; after acceptance it should ideally be delivered through a one-time authenticated retrieval instead of replayed in every event.
- `aggregate_seq` older than last applied: acknowledge as duplicate/stale. Exactly next: apply. If a gap appears: save pending, request current snapshot, reconcile then resume.
- Acknowledge only **after durable database commit**. A network ACK lost after commit must not make the event apply twice.

### 5.3 API and security boundaries

| Surface | Caller | Authentication | Implementation |
|---|---|---|---|
| Matendo `api/broker/v1.php` | mCare bridge backend only | Existing HMAC signature + replay defense | Preserve v1; add allowlisted action scopes/command IDs |
| mCare `functions/matendo-bridge` inbound events | Matendo server only | Existing HMAC signature + nonce, later independent service identity as feasible | Do not rely on CORS or disabled Supabase JWT verification as authentication |
| mCare patient commands | mCare browser/app | Normal user session → mCare function → signed Matendo request | Enforce owner/delegate/resource checks server-side for every command |
| Clinician chart handoff | Matendo clinician to mCare | mCare session or short-lived one-time scoped authorization after account linking | Validate assignment, licence, time, recipient and origin |
| Photos / documents / voice | Authorized subject only | Short-lived signed retrieval and storage policy | Never public permanent URL; expire/revoke with access |
| Status and reconciliation | Authorized backend workers | Service auth plus least privilege | No publicly callable unrestricted admin/service-key operations |

**Current HMAC v1:** `X-Bridge-Signature: t=<unix>,n=<nonce>,s=<sha256-hex>`; `s=HMAC(secret,t + '.' + n + '.' + raw_body)`, five-minute skew and one-use nonce. Continue to support it. **UPGRADE:** add `key_id` for rotation with overlap; use independent signing secrets per direction if feasible; keep at-rest nonce TTL/cleanup; enforce HTTPS, strict destination allowlist, bounded request size and server-side rate limits. Do not put `MCARE_BRIDGE_SECRET`, Supabase service-role key or payment secrets into `VITE_*`, analytics or browser responses.

### 5.4 Command response and error model

For new commands return `request_id`, `status`, authoritative reference, `aggregate_seq`/version and clear retry semantics. Use `202 Accepted` for durable in-progress processing where appropriate, `409 Conflict` for state conflict, `422` for validation, `403` for authorization, `429` for rate limit and retryable `5xx` only for transient failure. Adopt consistent `application/problem+json` errors (RFC 9457), but keep legacy `{ok, code, message}` compatibility adapter in v1 clients.

```json
{
  "type": "https://docs.example.invalid/problems/state-conflict",
  "title": "Booking state changed",
  "status": 409,
  "detail": "Refresh the booking before attempting this action.",
  "code": "state_conflict",
  "correlation_id": "trace-id",
  "retryable": false
}
```

Avoid exposing database/stack details. Never automatically retry **non-idempotent** financial actions with a new key.

---

## 6. Reliable sync, zero duplication and offline recovery

### 6.1 Required delivery model

Implement **transactional outbox + idempotent inbox + reconciliation** in both apps:

1. During the **same local database transaction** as a domain change, persist an immutable outbox entry; only then commit.
2. Worker claims pending rows with a lease/lock; sends signed event; retries transient errors using capped exponential backoff with jitter.
3. Recipient validates sender/signature/version/payload, inserts unique `event_id` into inbox, checks aggregate and seq, applies projection in a DB transaction, commits, then replies with ACK.
4. Duplicate `event_id` returns prior ACK without reapplying. Failed events remain queued; after bounded retry, send to **dead-letter review** with safe redacted diagnostic.
5. Reconciliation compares the authoritative `HV`, `CP`, `CS` aggregates and latest acknowledged versions; restores missing events or refreshes a projection without changing source facts.
6. Alert on stuck queues, expired leases, message gaps, consistent 401/403, wrong patient mapping and unreconciled financial statuses.

**Do not claim exactly-once network delivery.** Use at-least-once delivery with effectively-once business effects via constraints, transaction boundaries and durable idempotency.

### 6.2 Minimum persistence and constraints — additive migrations

**Matendo / MySQL:** keep existing `bridge_outbox` and `bridge_nonces`. Extend, without dropping data, to include immutable `event_id`, aggregate ref/type, integer `aggregate_seq`, protocol version, delivery state, attempts, next attempt, locked-until/claim owner, timestamps, last safe error, correlation ID. Add `bridge_inbox` for incoming commands/events; unique `(origin,event_id)` and/or `(origin,idempotency_key)`; unique aggregate revision `(type,ref,seq)` where appropriate. Persist stable clinician external refs and aliases. Reuse existing package and visit unique indexes. Index `(delivery_state,next_attempt_at)`.

**mCare / PostgreSQL:** keep `home_visits`, `care_packages`, `matendo_clinicians`, `bridge_outbox`, `bridge_nonces`. Add `bridge_inbox`, `bridge_mappings` (subject type, local ID, external ID, verified binding state), `bridge_sync_cursors` (per aggregate), and incident/reconciliation metadata. Enforce unique `(source,event_id)`, `(source,idempotency_key)` where meaningful, one active mapping per identity and reference uniqueness. Enforce strict service-only grants/RLS. Use least-privileged `SECURITY DEFINER` routines with secure `search_path`, validate caller/role, and revoke broad execute privileges.

**Both:** store an immutable financial journal instead of updating historical amounts; unique external provider transaction references with provider scope; unique payout and refund request IDs; `CHECK`/enum and foreign-key validations for valid lifecycle states. Use **expand → backfill → verify → switch → contract**. Write reversible migrations or tested restoration for each stage.

### 6.3 Guaranteed behavior when either system is unavailable

| Failure | Patient-facing behavior | Server action |
|---|---|---|
| Matendo unreachable before create | “Unable to confirm booking yet” and retry same command | Keep local draft/pending; do **not** mark confirmed or charged |
| Response lost after Matendo created visit | “Checking booking status” | Retry `book` with **same** idempotency key or query by reference; never create another |
| mCare unavailable after payment | Matendo continues safe dispatch/finance; show limited clinical pending banner | Queue updates; clinician chart/document step remains pending; do not bypass required clinical sign-off |
| Out-of-order events | UI continues with last committed state | Fetch authoritative snapshot, apply latest seq |
| Clinician enrolment delayed | “Clinical access being prepared” | Hold chart access, repair verified identity binding; never grant by guess |
| Signed-note attestation delayed | “Record signed, settlement pending sync” | Retry exactly same attestation; do not force a second signature |
| Package/shift update delayed | Last confirmed team/shifts shown as potentially stale | Refresh by `CP/CS` and disable unsafe actions requiring fresh assignment |
| Payment provider callback unavailable | Pending verification, no false success | Provider reconciliation queue and timed ops alert |
| Safety event when bridge down | Matendo handles safety directly | Never rely on mCare to deliver an SOS |
| Consent revoked / clinician suspended | Immediate deny for fresh actions | Revocation event high-priority; mCare local access guard checks expiry and suspension directly, then reconciles |

### 6.4 Consistency targets (service objectives, not claims)

Recommended pilot targets: routine event to UI convergence **within 10 seconds** under healthy conditions; critical safety revocation **immediate at Matendo authority and within 30 seconds on mCare projection** (with short-lived access verification and fail-closed authorization); dead-letter queue **0 unreviewed critical records**; reconciliation every **5 minutes** for active visits/packages and at least daily for finalized accounting; measurable RPO/RTO and restored-backup tests before production. Tune targets after real load tests and clinical safety review.

---

## 7. Payments, pricing, invoices, refunds and audit

- **Matendo only** owns financial records, provider callbacks, collection confirmation, fees, wallets, disputes, refunds and payout instructions. mCare shows only an authorized summary and next action.
- Quote breakdown has `visit_or_shift_fee`, `travel`, `Matendo_service_fee`, `applicable_tax`, `total_due`, `currency=UGX`, version, expiry and terms. Snapshot amounts at commitment; future rate changes never rewrite accepted jobs.
- Current documents illustrate a 25% platform service fee and VAT on that service fee. **Treat figures/tax characterization as the documented pilot policy, not freshly validated legal advice.** Confirm tax treatment, EFRIS, withholding, licensing and agent characterization with qualified Ugandan legal/tax advisers before go-live.
- Cash at the door prohibited for this flow. External payer allowed via controlled payment instruction; payer details do not grant medical-data access.
- Manual Mobile Money: staff independently match provider/wallet statement, amount, currency, payee and unique reference. A typed transaction ID **does not** prove payment. Enforce separated maker/checker for high-risk/high-value refunds or settlements.
- Automated Mobile Money: verify signed provider callback **and** server-to-provider status/reconciliation, protect against callback replay/duplicates/amount mismatch. One transfer/reference cannot fund two visits or two weeks.
- Immutable journal posting: collection → held clinician payable + platform fee + relevant taxes; on fulfilment payout or on cancellation refund/adjustment. Use balanced entries and reconciliation queries. Actual journal structure must align with existing Matendo ledgers; do not duplicate facility `payments`.
- Dispute, fraud, wrong-person, missed clinical sign-off, legal hold or serious safety incident **blocks payout**. An exception requires named authorized reviewer, reason, evidence, timestamps and a reversing entry as needed.
- Patient displays receipt/reference; clinician displays gross agreed earnings, deductions if applicable and net payout; finance exports CSV and PDF from **Matendo's authoritative** totals. Do not let mCare regenerate financial totals independently.

---

## 8. mCare clinical records, signing, documentation and follow-up

- A **single patient profile** holds allergies, relevant conditions, vitals, readings, clinical notes, signed reports, medications, care plans, medical documents and visit history. Visit/package/shift references link the record; no duplicate clinical record created for every booking.
- **Visit note:** presenting concern, assessment, relevant vitals, findings, investigations/results, recommendations, follow-up, author, dates/time, visit reference, clinical signature state. Apply role-based required fields; do not force all cadres to document like a doctor.
- **Care plan:** assessment and goals, approved interventions, schedule, clinical tasks, authorized administering clinician, review date and signed approvals. Matendo receives only the plan's approved/review state and necessary operational task scope, never narrative diagnosis.
- **Handover:** structured shift reference, performed care, relevant safety issues, medication administrations, outstanding concerns and next shift action; sign/audit; outgoing clinician's access revoked on assignment end, subject to an explicitly limited documentation completion window.
- **Signing:** use existing `home_visit_sign`, `care_handover`, `home_visit_guard` and audit pattern. Implement signer identity binding, signature timestamp, server-side hash and sequential addenda/correction workflow. A signed entry must not be edited directly; a correction links to the original and preserves both.
- **Patient documents:** show finalized visit reports under Documents/Health without manual uploads; patient/authorized delegate can securely download accessible PDFs; exports/CSV follow real access permissions. Matendo should only show an external link and signature status.
- **Vital alerts:** integrate new measurements into mCare's existing alert/re-measure/resolution system; do not create a duplicate home-visit alert engine. Clinical alerts and operational safety incidents must remain separate domains with appropriate notifications.
- **Data minimization:** use existing clinician scoped access and access-log mechanisms. On visit expiry or loss of assignment, revoke broad chart access; allow only specifically authored documents where policy grants ongoing legitimate access.
- **Not in v2:** diagnosing patients, modifying treatment plans, prescribing medication or releasing controlled substances autonomously with an AI agent.

---

## 9. Trust, safety and special circumstances

### Required controls in Matendo and reflected safely in mCare

1. Enforce verified current professional licensing, council/cadre eligibility, panel approval, acceptance of terms, availability, non-suspension and correct assignment **again at check-in**, not only at initial matching. Exact Ugandan licence and practice requirements require legal/regulator validation.
2. Verify patient's booking contact by OTP, limit enumeration/OTP attempts, monitor abuse and support controlled family booking.
3. Arrival PIN: securely generated, stored encrypted/hashed as appropriate, rate-limited, expired at completion, 5 failed tries lock/alert. Keep out of logs, analytics and generic event storage where feasible. Deliver only via authorized patient screen or verified on-site number.
4. Face/identity confirmation: verified photo, patient visual comparison, liveness/selfie or manual ops review with documented evidence. An unreviewed photo is **pending**, not a confirmed identity. Implement risk-proportionate privacy/retention controls for biometrics.
5. Clinician SOS and safety timer operate directly in Matendo, with staffed escalation, on-site location available only to authorized response operations, and careful retention. Safety exit never requires finishing a clinical form or collecting money first.
6. For minors, guardian presence and authority are recorded and confirmed at each relevant visit/shift; refusal/no guardian is a safe no-start condition, with reviewed financial policy.
7. For incapacity, consent refusal, infection hazards, documented patient transfer/death, live-in privacy, cameras and clinician sex preference, keep clear supported statuses and escalation. Do not substitute AI interpretation for consent or emergency decisions.
8. No access to a full chart before formal acceptance and identity binding; no permanent chart access through a care team card when package pauses/ends.
9. Blocked parties never rematch; serious allegations immediately create a restricted safety incident, preserve necessary evidence and pause payment while investigated.
10. Failed GPS/device permissions cannot fabricate check-in. Provide supervised, audited exception handling with reason and additional verification.

**Emergency routing:** use emergency instructions verified for the launch jurisdiction, ops staffing and intended clinical service. The existing documents display an emergency-screen reference to `112`; verify current local routing and add emergency-contact configuration before production. Matendo is **not** an emergency ambulance dispatch substitute.

**Retention:** source documents propose 30-day voice and 90-day selfie retention. Treat these as configurable **pending legal/privacy approval**, with purpose limitation, scheduled deletion, backups expiry, subject rights and an explicit legal hold mechanism. Uganda data-protection registration/data-sharing paperwork and cross-service processing agreements remain external compliance tasks.

---

## 10. Security controls and implementation hardening

- **Object-level and property-level authorization** on every visit, person, package, shift, handover and document operation. Never authorize access merely because a client supplies a valid-looking reference. Align threat tests with OWASP API Security Top 10.
- **Bridge secret only server-side**, HTTPS in production, rotate with `kid`/dual acceptance window. Apply constant-time MAC compare, bounded timestamp skew, nonce uniqueness, payload size cap, rate limits and endpoint network restrictions when possible.
- **Signed webhook ≠ end-user authorization.** A service event must be bound to its allowed origin/event/aggregate, not a blanket service-key write.
- **RLS everywhere on mCare's sensitive tables.** RPC functions must validate current actor/subject, scope and token; cross-app service routines must be unavailable to ordinary roles. Audit `SECURITY DEFINER` and `GRANT EXECUTE` carefully.
- **Secure email and link handling.** No automatic assignment of doctor or patient authority based on email alone. Use signed, short-lived single-use invitations and explicit confirmation by the intended owner.
- **CSRF/CORS:** CORS controls browser origin behavior, **not** authorization. Current Edge Function may use a configurable `'*'` origin; restrict production origins, avoid reflecting arbitrary origins and still verify JWT/session on user commands.
- **Secure uploads:** encrypt voice/images, inspect MIME and file signatures, enforce max sizes, scan uploads, expiring retrieval links, prohibit public buckets and redacted metadata/logs.
- **Medical record audit:** append-only patient/chart views, clinician actions, consent, signature, administrative overrides, settlement decision and sync repairs. Restrict audit access and preserve tamper-evident evidence.
- **No secrets in repo, build logs or AI prompts.** Sanitized `.env.example` only; use secret manager and service separation for local/staging/prod.
- **Graceful key/identity migration:** old clinician refs remain valid aliases until all mapped records are migrated. Run collision and orphan checks before retiring them.
- **Sensible browser behavior:** accessible controls, no secrets in `localStorage`, no patient details in URL query strings or push notification bodies, safe idle logout, branded offline states and device-responsiveness parity.

---

## 11. Unified settings and operational dashboards

### 11.1 Matendo settings (reuse existing keys)

Home visit settings already described in source: `home.travel_bands`, `home.ops_hours`, `home.new_patient_hours`, `home.max_radius_km`, `home.default_radius_km`, `home.widen_after_min`, `home.unfilled_alert_min`, `home.exclusive_min`, `home.handback_min`, `home.payment_window_min`, `home.asap_expiry_min`, `home.safety_grace_min`, `home.safety_escalate_min`, `home.auto_confirm_hours`, `home.no_access_wait_min`, `home.checkin_flag_m`, `home.eta_kmh`, `home.require_selfie`, `home.require_signed_record`, `home.voice_retention_days`, `home.selfie_retention_days`, `home.late_after_min`.

Care package settings described in the archive: assessment/review intervals, package options/rates, grace and reminder periods, team caps, shift/rest/welfare rules, safety and extension adjustments. Before building a new settings table, **locate and reuse existing Matendo settings implementations**. Value changes must be validated, permissioned, versioned and audited; never seeded as production financial truth.

**Proposed bridge settings:** `bridge.enabled`, `bridge.protocol_version`, `bridge.sync_max_attempts`, `bridge.reconcile_interval`, `bridge.alert_backlog_age`, `bridge.disable_new_bookings_on_degraded`, `bridge.secret_key_id`, `bridge.access_token_ttl`; env secrets remain outside DB.

### 11.2 Minimum operational screens

| Screen | Owner | Must display and allow |
|---|---|---|
| Bridge health | Both authorized administrators | Connectivity, current versions, last ACK, queue/dead-letter counts, consumer lag, discrepancy count, time of last reconciliation |
| Identity/link review | Authorized mCare privacy/admin | Link suggested/pending/verified/revoked, conflicts, caregiver grants, clinician mapping, safe re-verification |
| Active visits/packages | Matendo operations; mirrored subset in mCare | Correct reference, status, staff, alerts, tasks, countdowns and next step |
| Payment/reconciliation | Matendo finance | Provider evidence, open amounts, pending/double reference, payout gates, refunds, maker/checker review |
| Access audit | mCare authorized staff and patient view | Who viewed their records, why, when, current access grants and revocations |
| Clinical completion | mCare clinical leaders | Unsigned visits, missing handovers, overdue reviews, notes requiring addendum |
| Safety operations | Matendo staffed operators | SOS, late arrivals, identity mismatch, uncovered shifts, suspicious repeated incidents |

Show an **“Action required”** state with a direct permitted action, not a vague red generic error. Provide correlation ID for support. Do not expose technical stack traces to users.

---

## 12. Required feature backlog — specific code ownership and priority

| Priority | Work item | Matendo files/owner | mCare files/owner | Done when |
|---|---|---|---|---|
| P0 | Stabilize versioned identity and references | `mcare_bridge.php`, additive migration | `matendo.mjs`, mappings migration | Verified pairing; no email-only claims; refs survive key rotation |
| P0 | Strongly idempotent book/package/pay actions | `api/broker/v1.php`, `patient_requests.php`, `care_packages.php` | `matendo.mjs`, UI command IDs | Lost response and repeated clicks produce one aggregate/financial effect |
| P0 | Outbox/inbox and sequential revisions | `bridge_outbox`, `mcare_bridge.php`, worker | `0017`/new migration, `matendo.mjs` | Duplicate/out-of-order/retry/partial-failure tests pass |
| P0 | Strict clinician access and revocation | Home Care Panel, shift checks | `visits()`, `care_team_of()`, RLS, app auth | Wrong clinician, expired/suspended panel, revoked care team get 403 |
| P0 | Payment gates and reconciliation | `home_visit_money.php`, `care_packages.php`, finance workflows | Read-only payment status projection | No unverified or duplicated payout; documented refund path |
| P0 | Secure consent and dependents | Home recipient access | `managed_by`, `cares_for()`, link workflow | No unrelated household member can claim chart |
| P0 | Clinical sign/handovers + durable ACKs | Accept attestation idempotently | `home_visit_sign`, `care_handover`, outbox | One signed record, one shift handover, no lost payout signal |
| P1 | Full package/shift UX and assessment review | Package operations/rota | `homeVisits.tsx`, doctor UI, `0018` | Assessment → weekly pay → shifts → review → closure all work |
| P1 | Automatic provider collections/payout confirmation | Server-only provider integration | Status only | Real provider sandbox and replay tests validated |
| P1 | Face verification or supervised review | Selfie checks/ops | Approved clinician card | Manual review safely blocks payout until decided |
| P1 | Push/SMS delivery with safe fallback | Clinician/ops notifications | Patient notifications | Real devices receive correct messages; no PHI leaks |
| P1 | Admin bridge dashboards, alert rules | Ops/finance screens | Sync/access audit screens | Failed events and access anomalies actionable |
| P2 | One-time cross-app handoff, consent experience | Signed link issuer | Verified link redeemer | No second confusing registration; no token leakage |
| P2 | Smart ETA and matching suggestions | Opt-in, non-clinical decision support | Only display confirmed estimates | Suggestions explainable and overridable; safety priority |
| P2 | Optional standardized clinical data exports | Only references | mCare resources/export service | Interoperability never weakens privacy or data ownership |

**Do not reorganize the entire codebase to implement this bridge.** Prefer a compact common contract/test fixture and adapters to existing modules; no third duplicated data store or parallel pricing engine.

---

## 13. Test plan — release-blocking requirements

Test against **matching commit hashes** of the final Matendo and mCare repositories. Use separate sandbox databases and fake people only. Never run destructive migrations or replay payment providers against real production without controlled approval.

### 13.1 Static/contract checks

- [ ] Run Matendo PHP lint for all touched files, static/security checks and existing unit tests.
- [ ] Run `node --check` on mCare bridge shared module and tests; `npm run typecheck`, `npm run build`, `npm run test:db`, `npm run test:api`, `npm run test:ui` (where tools/dependencies are installed).
- [ ] Run Matendo `php tools/test_home_visits.php`, `php tools/test_care_packages.php` and the relevant HTTP journeys using **documented valid environment setup**; do not claim a pass unless actually executed.
- [ ] Run `MATENDO_DIR=<path> MATENDO_BRIDGE_SECRET=<test-secret> node supabase/tests/matendo.test.mjs` with both test services and clean databases; record counts and failures. Existing docs report 97 passed on 19 October, which must be rerun after changes.
- [ ] Confirm old v1 callers and new v2 protocol both function in staging.
- [ ] Verify migration up/down or tested restore, indexes/FKs/checks, RLS, SQL function privileges, no unintended writes to facility financial tables.

### 13.2 Scenario matrix

| # | Required E2E scenario | Pass condition |
|---|---|---|
| 01 | Book through mCare, book through Matendo | One Matendo visit reference per intent; correct mCare record in both flows |
| 02 | Same family member booked repeatedly | Same verified person, no duplicate clinical identity |
| 03 | Relative attempts to claim Health ID with unrelated phone/email | Rejected, indistinguishable enumeration response |
| 04 | Two people share phone/email | No accidental linking or chart exposure |
| 05 | Double tap / network timeout during `book` | Only one visit and one payable quote |
| 06 | Double tap / lost reply during package request | One package + at most one needed assessment visit |
| 07 | Fake/duplicated Mobile Money reference | Not marked paid; no dispatch/payout |
| 08 | Provider callback replay/mismatch | Idempotent rejection/hold; journal unchanged |
| 09 | Clinician licence lapses while job active | New assignments denied; existing job handled by explicit safe ops policy |
| 10 | Non-assigned clinician opens record | `403`, access audit, no data leakage |
| 11 | Clinician goes offline mid-visit | Matendo safety still works; mCare draft/confirmation reconciles |
| 12 | Wrong arrival PIN five times | Lock and alert; cannot check in |
| 13 | Selfie mismatch / patient “not the person” | Safe halt/review; funds held; chart revoked |
| 14 | Lost signed-note ACK | Note remains single/immutable; Matendo eventually receives attestation |
| 15 | Two out-of-order `visit.updated` events | Last **valid higher revision** remains |
| 16 | Same event delivered 10 times | One business effect and one inbox record |
| 17 | Malformed, stale, replayed or unsigned event | Denied; safe log; no state changes |
| 18 | Invalid origin or unintended browser bridge call | Denied even if CORS request was allowed |
| 19 | Matendo down for 30 min then restored | Pending commands reconcile; no duplicate visits/charges |
| 20 | mCare down during check-out | Safe closure and queued clinical completion; payout gate preserved |
| 21 | Package assessment approved/declined | Correct transition, clinical record and patient messaging |
| 22 | Seven days of package shifts, assigned care team | Correct access, rota, hours, quote and charge per period |
| 23 | Incoming shift worker late / replacement called | No overlapping double bill; handover and safety escalation correct |
| 24 | Controlled medication dose entry edited/deleted | Forbidden; legitimate audited correction possible |
| 25 | Package paused, resumed, admitted/ended | Future shifts and payments adjusted, chart access expires |
| 26 | Signed handover ACK dropped/replayed | No duplicate payout; persisted handover remains |
| 27 | Consent revoked / caregiver removed | Patient/chart access revoked with audit and no accidental inheritance |
| 28 | Bridge secret rotation and legacy clinician refs | No broken mapped users or history |
| 29 | Real device (mobile/tablet/desktop) | Functional responsive UI, same statuses and authorized controls |
| 30 | Operational dashboard/incident | Stuck event visible; retry and repair audited, no manual DB hacks |
| 31 | Backup restored to isolated environment | Recovery and reconciliation verified with no double settlement |
| 32 | Clinical report PDF/export | Authorized only, current signed information, traceable document |

### 13.3 Quantitative acceptance goals

- **Zero** duplicate visits/packages/verified financial events across 100 forced timeouts/retries in automated staging fault injection.
- **Zero** unauthorized cross-patient reads in the full RBAC/RLS test matrix.
- **Zero** payouts while payment, identity, visit completion, mandatory sign/handover or dispute checks are unsatisfied.
- **100%** retained valid records after additive migration/backfill and tested restoration.
- All **32 scenarios** have evidence: test ID, commit hash, environment, timestamp, result, defect link and reviewer; no undocumented skips for P0 scenarios.
- Latency, queue lag, and remediation alerts measured under load and from at least one real mobile network, not just localhost.

---

## 14. Build and rollout order (AI coding agent execution instructions)

**Phase 0 — establish truth:** inspect the actual repositories and deployed schema; record branches/commit hashes, real scripts, migrations applied, secrets configured, current test output, relevant screenshots and all discrepancies from this specification. Never substitute archive assertions for production evidence.

**Phase 1 — contracts and guards:** add v1 compatibility fixtures, versioned event schemas, permission/identity linking invariants and tests. Document existing expected `HV/CP/CS/MH/mtc` references. Fix ID/secret rotation risk before changing payload formats.

**Phase 2 — additive migrations:** implement inbox, aggregate revisions, correlation/idempotency keys, durable external clinician mappings, consent/relationship grants and useful indexes. Backfill on staging; verify uniqueness, rollback/restore and data reconciliation.

**Phase 3 — bridge worker hardening:** transactional emit, signed delivery, inbox dedup, backoff/dead-letter, gap repair, status reconciliation and monitoring. Keep existing `api/broker/v1.php` and `matendo.mjs` adapters live while switching consumers gradually.

**Phase 4 — patient/clinician clinical journey:** fix book/pay/accept/check-in/record/sign/confirm/release flow with safe offline behavior, role-specific chart access, guardian/safety cases, one-click retry and clear statuses. Do not duplicate UI state logic between screens.

**Phase 5 — care packages:** connect assessment + approval, package pricing, weekly payment, care-team rota, shift check-in, handovers, dose entries, review schedule, pause/end/refunds and all access/revocation events.

**Phase 6 — live dependencies:** hosted Supabase Edge Function, production-domain CORS, key management, provider collection/payout callbacks, SMS/push, selfie service or staffed manual queue, privacy contracts and local emergency settings; test in provider sandbox and staging first.

**Phase 7 — pilot release:** feature flag on for designated test cohort; retain version-1 adapter; shadow-compare snapshots and reconciliation metrics; activate new booking only when P0 gates pass; train clinical/ops responders; then expand deliberately.

**Phase 8 — continuous audit:** monitor lag, failed deliveries, broken identity links, clinician expiries, incident handling, unsigned notes, overdue reviews, payment discrepancies and daily reconciliation. Run automated regression after every change affecting shared contracts.

### Mandatory instructions to implementing agent

1. **Read existing code first; report actual findings and affected paths.** Treat this document as target behavior, not proof it is already installed.
2. **Create a short, dependency-ordered plan** and implement in controlled commits/patches, with tests after each phase.
3. **Do not create parallel modules when working equivalents already exist.** Extend existing ownership boundaries and share UI components/hooks instead of copying them.
4. **Never delete a migration, signed clinical record, finance journal, facility feature or production data to make tests pass.**
5. **Do not hardcode patients, clinician credentials, fees, payments, provider references or seeded production results.** Synthetic local/staging fixtures remain isolated.
6. **Investigate every error** (type, SQL, auth, API, state, UI, payment or sync). Fix its root cause and add a regression test; do not silence it with broad catch blocks.
7. **A feature is only “working” after integration tests prove it**, with dependencies live or explicitly simulated. Clearly mark external dependencies and unsupported offline features.
8. **Finish with one implementation report** in commit/PR description: modified files, schema changes, test results, permission review, remaining risks, rollback instructions and go-live decision. Keep this MD as the single ongoing functional specification.

---

## 15. Environment/deployment checklist and rollout gates

**Matendo:** `HOME_VISITS_ENABLED`, `MCARE_BRIDGE_URL`, `MCARE_BRIDGE_SECRET`, `MCARE_APP_URL`, database/queue/cron credentials and provider integrations. `cron/home_visits_sweep.php` exists in archive; ensure actual scheduler and health alarms run. Do not enable home visits because a config example contains `1`.

**mCare:** `MATENDO_BROKER_URL`, `MATENDO_BRIDGE_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side), correct mCare app origin. A public `VITE_MATENDO_URL` may be used only for safe public navigation/photo allowlists, **never** secrets or privileged calls. Deploy `functions/matendo-bridge/index.ts` with its documented JWT mode only after proving internal service signature verification and regular user JWT validation work in production.

**Each environment must have separate:** signing secrets, database, authenticated user identities, public origins, payment sandbox/live configuration, SMS credentials, storage buckets, migrations, outbox/nonce stores, audit destinations and backup policy. No mixing local `localhost` endpoint into hosted config.

**Production release gates:**

- [ ] Both service owners approve contract and data-sharing boundaries.
- [ ] Matching migrations applied in staging; backups/restoration proven.
- [ ] P0 tests, security/RLS, replay/idempotency and failover tests pass.
- [ ] On-site safety operations and escalation contact schedules staffed.
- [ ] Clinician regulatory checks and care-governance protocols signed off.
- [ ] Ugandan tax/privacy/licensing positions reviewed with appropriate professionals; unresolved EFRIS/data protection obligations tracked.
- [ ] Real payment, refund, delivery and identity-review workflows validated; or explicitly disabled with transparent manual controls.
- [ ] Reconciliation dashboard and dead-letter alerts staffed.
- [ ] Feature flag and rollback procedure rehearsed without data loss.
- [ ] Pilot results reviewed before wider rollout.

### Stop-release conditions

Any patient data exposed to wrong user, clinician without valid required authorization sent to visit, safety alert unhandled, paid status created from an unverified text reference, duplicate financial settlement, signed clinical record overwritten, broken caregiver revocation, missing mandatory live clinical sign-off or unreconciled orphan visit/package is a **blocker**. Disable new creation for the affected pathway; preserve existing care and incidents, reconcile/recover and retest.

---

## 16. What is genuinely better in this version

| Weakness in previous MDs/older implementation pattern | Unified v2 decision |
|---|---|
| One-off home-visit focus, missing newer package work | Fully integrates `CP` care packages, `CS` shifts, assessments, team, handovers, medicine logs, weekly payments |
| Phone/email/Health ID treated too easily as identity proof | Verified linking + explicit caregiver scope + conflict/claim workflow |
| Same HMAC secret also determines clinician reference | Stable external IDs and aliases; safe key rotation |
| Timestamp-based visit `seq` | Atomic per-aggregate monotonic revision |
| Outbox described without complete receiver dedup/recovery | Transactional outbox + inbox + retries, dead letters and reconciliation |
| Mismatched clinical and operational state after outages | Defined state authority, stale UI behavior and end-to-end recovery |
| Full amount/arrival PIN at risk of over-sharing in snapshots | Minimum necessary projections, short-lived access, safe secret handling |
| Payment acknowledged by a user-entered transfer ID | Provider/independent verification, journal, duplicate protection and payout gates |
| Nurse/other staff potentially mapped into “doctor” simply to use mCare | Professional role-specific scope and verified account binding |
| “All working” inferred from old test counts | Explicit archive baseline, real test evidence and go-live gates |
| Vague AI implementation request | Ordered, path-aware tasks with permissions, data flow, migrations and measurable tests |

---

## 17. Authoritative references and open decisions

### Existing project sources (the basis for this file)

- Matendo: `docs/pilot/10-home-visits.md`, `11-mcare-bridge.md`, `12-care-packages-and-special-circumstances.md`; `config/mcare_bridge.php`; `api/broker/v1.php`; `sql/migrations/2026_127_home_visits.sql`, `2026_128_care_packages.sql`.
- mCare: `AGENTS.md` §15; `supabase/migrations/0017_home_visits.sql`, `0018_care_packages.sql`; `supabase/functions/_shared/matendo.mjs`; `supabase/functions/matendo-bridge/index.ts`; `supabase/tests/matendo.test.mjs`.
- User-provided standalone documents `13-Home-Visits-Patient-Arm.md`, `14-Matendo-mCare-Bridge.md` and the unverified `PROJECT_CONTEXT.md`.

### Engineering standards consulted for new hardening recommendations

- OWASP API Security Top 10 (2023): <https://api-security.owasp.org/editions/2023/en/0x11-t10/> — authorization, authentication, resource and sensitive business flow protection.
- IETF RFC 9457: <https://www.rfc-editor.org/rfc/rfc9457.html> — standardized HTTP problem details for interoperable errors.

### Open decisions — must not be silently invented

1. Confirm legally appropriate clinician licence/practice requirements and Matendo's agent role with local advisers.
2. Approve current tax, WHT, VAT, EFRIS receipt and service fee behavior in production.
3. Establish signed privacy/data-sharing agreement and retention periods, including any biometric data handling.
4. Decide final approved guardian/next-of-kin evidence policy and how disputed family claims are handled.
5. Select payment provider integration, payout policies, selfie/identity verification provider or properly staffed manual review.
6. Decide accepted availability/fail-safe thresholds and emergency escalation contacts appropriate for the pilot geography.
7. Define migration of hidden managed-patient auth accounts and nurse/clinician role mapping, without losing history.
8. Confirm which historical docs are safe to archive after this unified contract is adopted; legal agreements, operations SOPs and migration history are **not** replaced by this MD.

---

## Final implementation success definition

**Fully functional** means: a patient books from either app; identity and caregiving authority are correct; a single visit or care package is created; Matendo alone confirms payment and dispatch; an authorized clinician safely attends; mCare holds one longitudinal clinical history and immutable signed documentation; shifts and handovers synchronize; Matendo settles only legitimate work; both systems recover from network and service failures without duplication; nobody sees records they are not entitled to; and every important exception is visible, traceable and resolvable by the correct role. **Do not label the system production-ready until these outcomes have been demonstrated in staging and the live external dependencies have been verified.**
