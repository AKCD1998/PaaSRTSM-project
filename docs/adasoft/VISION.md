# SC Group — Full System Vision & Build Context

## Who we are

SC Group (1989) is a Thai pharmacy/retail chain with 6 branches (000=HQ, 001–005).
We run Adasoft AdaPos HyperMart 4.0 as our POS/ERP system. It works and we are not replacing it.
We are building a modern operational platform ON TOP of it to fix its biggest pain points and
capture the operational truth it cannot represent.

---

## Core philosophy

AdaPos/AdaAcc remains: accounting system, cashier/tax/compliance, legacy ERP/POS source of record.
We build around it to capture: operational reality, reconciliation, auditability, branch accountability,
CRM/customer intelligence, inventory truth, workflow intelligence.

**AdaAcc is ALWAYS READ-ONLY. No exceptions.**

**Never silently fix stock.**
- Preserve original events
- Record discrepancies with reasons
- Preserve timelines and accountability
- Corrections are EVENTS, not overwrites
- Operational truth matters more than making numbers look correct

---

## The five-component platform

### 1. PaaSRTSM — Central nervous system

Node.js + Express + PostgreSQL on Render.com.

- Shared PostgreSQL, shared auth/JWT
- Branch/staff identity, product master
- CRM/loyalty, reconciliation engine, analytics, audit trail
- Sync ingestion API, event normalization
- Branch ordering domain, future automation endpoints
- Serves SCCRMMVP (mobile), SC-StockDay UI, admin dashboard
- Receives point events from SCCRMonPOS

This is NOT just a CRM backend. It is the unified operational platform for the entire SC Group system.

### 2. SCCRMonPOS — Sensor and transport bridge

C# .NET 4.8 Windows tray app on each branch's POSSRV machine.

- Reads AdaAcc (POSSRV\SQLEXPRESS) for new paid sales — read-only
- Calculates points, queues and pushes events to PaaSRTSM API
- Offline queue for unstable internet — syncs on reconnect
- Reads TCNTPdtTnfHD to flag unprocessed inbound Type 7 receipts
- Has staff UI for manual point adjustments and customer registration
- NEVER writes to AdaAcc — read-only is the law
- NOT the business workflow engine — it is the bridge and sensor

### 3. Rx1011 — Specialized operational workflow module

**NOT obsolete. NOT being replaced immediately.**

Rx1011 contains mature, proven operational philosophy that SC-StockDay and PaaSRTSM must learn from:

- **Lot-aware inventory truth** — tracks product lot numbers through the entire workflow
- **Expiry-aware workflows** — flags products approaching expiry at the workflow level
- **Send/receive confirmation** — explicit operational confirmation step, not assumed
- **Audit-first corrections** — all corrections are logged events, never silent overwrites
- **Branch accountability** — who confirmed what, when, at which branch
- **Operational verification** — staff must verify before state advances
- **Discrepancy-conscious workflows** — built to capture "what actually happened" vs "what should have happened"

Rx1011 evolves into a specialized operational module connected to the PaaSRTSM ecosystem.
Think: "high-control inventory workflow module" — NOT "legacy app waiting to die."

**Rx1011's philosophy should heavily influence:**
- SC-StockDay workflow design
- Reconciliation UX patterns
- Audit/event architecture
- Confirmation step patterns in all workflows
- How we handle lot/expiry data from TPSTSalDT

### 4. SC-StockDay — Reconciliation engine

Records operational truth that AdaPos architecturally cannot represent:

| Truth | Why AdaPos Cannot Record It |
|---|---|
| Actual received qty | FCPthQtyRcv field does not exist in TCNTPdtTnfDT |
| Discrepancy qty and reason | No discrepancy field exists anywhere |
| Lot mismatch between dispatch and receive | No lot-level reconciliation table |
| Damaged goods on arrival | No condition flag in transfer system |
| Approval chain | No confirmation workflow in Type 7 processing |
| Transfer event history | Once processed, original dispatch detail lost |
| Linkage between adjustments and transfers | 1,632 manual stock adjustments = orphaned patches |

**Does NOT replace AdaPos stock/accounting.**
AdaPos remains the accounting endpoint, cashier system, tax/compliance record.
SC-StockDay records the operational reality alongside it.

### 5. SCCRMMVP — Mobile CRM

React Native (Expo) mobile app.

- **Customer mode:** points balance, tier progress, transaction history, rewards redemption
- **Staff mode:** PIN auth, customer lookup (phone/card/Thai ID scan), add/redeem points, new member registration
- Talks only to PaaSRTSM API — never touches AdaAcc directly
- Thai-first, max 3 taps to complete any action

---

## The two pain points being solved

### Pain Point 1 — Stock Transfer Reconciliation

When HQ (Branch 000) ships goods to a branch, AdaPos creates a Type 4 outbound document and
deducts stock from HQ. The receiving branch should create a Type 7 inbound receipt and add stock.

**2,835 of 3,091 inbound receipts (91.7%) were never processed.**

Branches have been selling goods the system says they don't have.
Staff patch it manually with 1,632 stock adjustment documents — no link to original transfers.
The system literally cannot record quantity discrepancy (FCPthQtyRcv does not exist in the DB).

**SC-StockDay + PaaSRTSM fix this** by recording the operational truth alongside AdaPos.

### Pain Point 2 — Customer CRM / Loyalty

AdaPos loyalty system (TCNTCstPoint) dead since November 2020. WCF sync broken since March 2026.
Only 33 loyalty transactions in the entire system across all branches and all time.
1,305 customer records SC Group does nothing with.

**SCCRMMVP + SCCRMonPOS + PaaSRTSM fix this** with a real loyalty and CRM system.

---

## Architecture diagram

```
AdaAcc (AdaPos DB — READ ONLY, NEVER WRITE)
    │
    ├── SCCRMonPOS (branch agent on each POSSRV)
    │       ├── watches new paid sales → push point events → PaaSRTSM
    │       └── watches Type 7 unprocessed receipts → flag for reconciliation
    │
    └── adapos-sync (scheduled read-only sync job in PaaSRTSM repo)
            └── pulls product master, branch list, transfer docs → PaaSRTSM PostgreSQL

PaaSRTSM API (Node.js/Express on Render — central nervous system)
    │── PostgreSQL (all CRM + reconciliation + audit data)
    │── serves → SCCRMMVP (mobile CRM app)
    │── serves → SC-StockDay reconciliation UI
    │── serves → admin dashboard
    └── event bus → Rx1011 operational workflows (lot/expiry-controlled products)

Rx1011 — operational workflow module (lot-aware, expiry-aware, audit-first)
    └── connected to PaaSRTSM ecosystem

SCCRMMVP (React Native mobile)
    ├── Customer: points, history, rewards
    └── Staff: lookup, add points, register members
```

---

## Event-driven integration philosophy

```
AdaAcc sale created
↓
SCCRMonPOS detects new paid sale
↓
PaaSRTSM receives normalized event
↓
→ Award points to member (CRM)
→ if product belongs to Rx1011-controlled group → emit Rx1011 operational event
→ if transfer-related → emit reconciliation event
→ CRM / analytics / audit trail update automatically
```

Avoid: double entry, separate manual recording, parallel inconsistent truths.

---

## AdaAcc — what you need to know to work safely

**READ-ONLY IS THE LAW. Never INSERT, UPDATE, DELETE, or EXEC anything in AdaAcc.**

### Connection
- Central server: `192.168.100.124` (WIN-N8RL1PCFEDO\SQLEXPRESS) — WAN-hosted over internet, NOT on local LAN
- SQL Server 2008 R2 RTM — EOL, unpatched, Express edition
- Use read-only SQL login — never `sa`

### Key tables
| Table | What it has | Use for |
|---|---|---|
| `TPSTSalHD` | 429,054 sale headers — branch, customer, amounts, date | Point earn trigger |
| `TPSTSalDT` | 836,892 sale lines — product, qty, price, **lot number, expiry date** | Pharmacy reminders, Rx1011 events |
| `TPSTSalRC` | Payment breakdown — 7 tender types | Payment tracking |
| `TCNMCst` | 1,305 customers — name, DOB, card, Thai ID | Member profile source |
| `TCNMPdt` | 6,663 products — 240 columns, point flag, 9 price levels | Point eligibility, product catalog |
| `TCNTPdtTnfHD` | 6,737 transfer docs — type, branches, date, status | Reconciliation source |
| `TCNTPdtTnfDT` | 71,153 transfer lines — product, dispatched qty | Reconciliation detail |
| `TCNMBranch` | 6 branches | Branch context |
| `TCNMWaHouse` | Warehouses per branch | Stock location |

### Key fields for point calculation
- `TPSTSalHD.FCShdGndAmt` — grand total (use for points)
- `TPSTSalHD.FTCstCode` — customer linked to sale
- `TPSTSalHD.FTShdStaPaid = '1'` — only count paid sales
- `TCNMPdt.FTPdtPoint` — product earns points flag
- `TPSTSalDT.FTSdtLotNo` / `FDSdtExpired` — lot and expiry per sale line

### Transfer document types
| FTPthDocType | Meaning |
|---|---|
| '4' | Outbound dispatch (HQ sends to branch) |
| '7' | Inbound receipt (branch receives) — 91.7% never processed |
| '1' | Warehouse receive |
| '2' | Warehouse issue |
| '3' | Warehouse-to-warehouse (same branch) |

`FTPthStaPrcDoc = '1'` = processed. Empty string = NOT processed (the problem).

### Sync lag
Branches sync manually via FTP (AdaSky.exe). Central AdaAcc may be 1–8+ days behind branch reality.
Always show "as of [last sync timestamp]" on any data from AdaAcc.

---

## CRM events to implement

### From AdaAcc data (available now)
| Event | Trigger | Action |
|---|---|---|
| Point earn | New paid sale in TPSTSalHD with FTCstCode | +1 point per 100 baht, post to member ledger |
| Product multiplier | TCNMPdt.FTPdtPoint / FCPdtPointTime | Double/triple points on flagged products |
| Birthday reward | TCNMCst.FDCstDob — monthly job | Bonus points or discount in birthday month |
| Tier upgrade | Cumulative spend reaches threshold | Bronze → Silver → Gold, unlock benefits |
| Lapsed customer | No TPSTSalHD for FTCstCode in 30 days | "We miss you" campaign trigger |
| First purchase | First TPSTSalHD for new FTCstCode | Welcome bonus |
| Medication expiry | TPSTSalDT.FDSdtExpired approaching | "Your medication expires in 30 days" push |
| Refill reminder | Same FTPdtCode purchased every ~N days | Proactive refill alert |
| Cross-branch loyalty | Sale at any branch credits same member | Seamless multi-branch experience |
| Thai ID auto-lookup | MOPH MQTT reader → TCNMCst.FTCstCardID | Tap national ID → member profile, no card needed |

### New infrastructure needed
| Feature | What to build |
|---|---|
| LINE notifications | LINE Messaging API — Thai users live in LINE |
| Referral program | New PostgreSQL table, referral code per member |
| Campaign builder | Admin UI — bonus point events with product/date/branch filter |
| Point expiry | Scheduled job — points expire after 12 months |
| B2B / clinic track | Separate CRM rules for VAT invoice customers (TACTVatHD) |

---

## UX philosophy

- **Thai-first**, English secondary — all staff-facing UI
- Operationally lean: **low-click, scan-first**
- Staff workflows: **max 3 taps** to complete any action
- Customer lookup: by phone, member card, or Thai national ID scan
- Offline-tolerant: SCCRMonPOS queues locally if API is down
- **Confirmation by exception** — only ask for confirmation when something is unexpected
- **Progressive disclosure** — don't show complexity until needed
- Minimize typing, preserve auditability without burdening staff
- Goal: **"minimum staff effort, maximum operational truth"**
- Error messages in plain Thai — never show stack traces to staff

---

## Long-term platform vision

```
AdaAcc (source of record — read-only forever)
↓
SCCRMonPOS (sensor + bridge on every branch POSSRV)
↓
PaaSRTSM operational platform
├── CRM / loyalty (SCCRMMVP frontend)
├── SC-StockDay reconciliation
├── Rx1011 operational workflows
├── analytics
├── audit engine
├── branch ordering automation
├── future automation
└── AI-assisted operations
```

Evolve carefully. Preserve operational trust.

**Do NOT:**
- Rewrite everything at once
- Merge repos blindly
- Destroy proven workflows in Rx1011
- Create duplicate product masters
- Silently overwrite operational data

---

## Security constraints

- Never write to AdaAcc (INSERT/UPDATE/DELETE/EXEC on any AdaAcc table)
- Never store `sa`/`adasoft` credentials in any config that leaves the branch machine
- Use a read-only SQL login for AdaAcc access from SCCRMonPOS
- PaaSRTSM API requires JWT auth on all endpoints
- Customer PINs from TCNMCst are plaintext in AdaAcc — do not copy them to PostgreSQL; generate new credentials for our system
- FTP credentials (`scgroup`/`Ad@Soft#21` at 147.50.231.154) are for Adasoft sync only — never expose in our code
- Never copy `TCNMCst.FTCstPin` to our database

---

## What you should never do

- Write to AdaAcc (INSERT/UPDATE/DELETE/EXEC on any AdaAcc table)
- Copy `TCNMCst.FTCstPin` to our database
- Expose `sa` credentials or FTP credentials in source code
- Assume AdaAcc data is real-time (it lags 1–8+ days)
- Use `FTPthStaDoc='1'` as a filter (all documents are '1' — useless)
- Use `FTPthStaPrcDoc=''` without also checking `DocType='7'`
- Silently overwrite or correct stock numbers — corrections are events, not overwrites
- Treat Rx1011 as legacy/obsolete — its operational philosophy is proven and must be preserved
