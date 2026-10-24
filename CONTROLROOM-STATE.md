# ControlRoom — build state & handoff

_Living status doc. Shared by all sessions/agents working this repo. Last major update: 2026-10-24._

## Decision log (the pivot)

The first design (a separate FastAPI + SQLite + Next 14 stack with an invented
world: `CAR-2391`, Hans Müller, ADAC, five faked "areas", agent-trace timelines)
was **scrapped** after a packet-grounded critique. We now build on the **real
starter and the real dataset**.

Why: the snapshot already models exactly what the brief asks for. `agent_proposals`
carry `evidence_refs`, a `rationale`, a `proposed_payload`, `status:PENDING_REVIEW`
and a `review`. Orders link to plans, alerts, conversations, messages, documents.
The customer is the dealer who pays. World is FI/DK/DE, snapshot `2026-10-21T09:00:00Z`.

**Current approach (agreed):**
- Build **on `starter/`** (Next 16.4.2 + React 19 + Drizzle + Postgres). One stack.
- The control room shows **only orders that need a person**, from the starter's own
  `deriveAttention()` evidence layer.
- Go **deep on ONE area — On the Road** — with one real tool-using agent.
- Hero order = **`ord-00322`** (Bentley Continental GT, `VEHICLE_WARNING` +
  `SAFETY_STOP` + `TRACKING_GAP`). This is the packet's real version of the brief's
  "Bentley" scene. The real proposal `driver.request_safe_stop_details`
  ("ask for the parked vehicle's location without giving mechanical advice") sets
  the intended behaviour.
- **Per-action approval**; the agent never contacts the customer; the case **stays
  open** until a verified place, the photo, and the owner's roadside-or-collection
  choice exist. Approving **sends nothing** and **does not change the snapshot**.

## What is built (in `starter/`, by the parallel agents)

Status: **feature-complete at the code level; `npm run typecheck` passes clean.**

New code:
- `lib/room/types.ts` — queue + card + decision types.
- `lib/room/on-the-road.ts` — reads the On-the-Road case off the snapshot; cited
  facts (quoted messages, incident, tracking gap, promise, photo doc); three
  **separate** actions (`ask-driver` sendable text, `hold-promise` writes nothing,
  `owner-call` the person makes); "already done / still open" (prior proposal +
  recovery work item); `missing[]`.
- `lib/room/queue.ts` — assembles the queue, sorts by tone then decisive date,
  splits heroes (On the Road) from the rest.
- `lib/room/load.ts` — `loadRoom()`: board bundles → cards → road cards (overlaid
  with any saved agent investigation) + decisions.
- `lib/room/driver-view.ts` + `app/drive/page.tsx` — a driver-phone simulator
  (driver-chat only; an approved message shows **separately** as "not on his phone
  yet", reinforcing that approval sends nothing).
- `lib/room/activity-view.ts` — surfaces room decisions + the agent look back on the
  order page's proposals section, in `ProposalView` shape.
- `lib/agent/investigate.ts` — the real tool-use loop (**Mistral**;
  `MISTRAL_API_KEY`, model `ministral-8b-2512`). Tools: `read_messages`,
  `read_incident`, `read_alerts_and_tracking`, `read_prior_proposal`, then
  `submit_decision`. Enforces: no diagnosis, no clearing to drive, no customer
  contact, driver draft asks only for place + photo. Facts stay cited; the model may
  only rewrite the summary/draft. Graceful fallback with **no key** → card = record
  reading.
- `lib/agent/guard.ts` — the approval seam: refuses a driver draft that would move
  the car / book recovery / state a time / contact the owner; one rewrite retry.
- `lib/agent/session.ts` — persists decisions + investigations to `room_activity`
  (upsert).
- `app/api/room/route.ts` (GET queue), `app/api/orders/[id]/investigate/route.ts`
  (POST run agent), `app/api/orders/[id]/decide/route.ts` (POST approve/reject,
  re-runs the guard, records decision, returns an honest effect string).
- `app/room/page.tsx` + `app/components/room-view.tsx` — the control-room UI: hero
  card with three decisions, cited facts with record links, "Look again with the
  agent", agent trace, refused-draft surface, and an "Also waiting" queue.
- `lib/schema.ts` — added `room_activity(id, order_id, kind, recorded_at, details)`,
  **no FK** so reseeding the snapshot never depends on it.
- Modified: `app/components/app-frame.tsx` (nav), `app/components/record/sections.tsx`,
  `app/api/orders/[id]/route.ts`, `app/globals.css` (room/drive styles), `README.md`.

## How to run (verified path)

Requires Docker Desktop running.
```sh
cd starter
# .env already present (DATABASE_URL + MISTRAL_API_KEY set)
docker compose up -d --wait        # Postgres :5438, attachments :9009
npm ci                             # already installed
npm run db:push                    # schema incl. room_activity
npm run db:seed                    # 100 orders + 4366 records
npm run attachments:seed           # optional (order files view); see KNOWN ISSUES
npm run dev                        # http://localhost:3000  (Next 16 first boot is slow, ~5 min)
```
Then open **http://localhost:3000/room** ("To decide"). `/drive` shows the driver's phone.

## Update — multi-area build (2026-10-24, later)

Expanded from one deep area to a **case-kind registry** (`lib/room/kinds.ts`): each
deep area is a `CaseKind` (detector + records-cited card + tool-using agent +
guards). On the Road keeps its original loop; new areas share a generic runner
(`lib/agent/run-agent.ts`). The queue (`lib/room/load.ts` + `queue.ts`) runs a cheap
first pass over board bundles, full-loads only the orders a deep area owns, builds
each card, and overlays any saved agent look. `room-view.tsx` renders any card
(kicker chip + generic Approve/Not-this buttons). `decide`/`investigate` routes
dispatch through the registry.

**Areas (5 of 5 deep, typecheck green, runtime-verified):**
- `on_the_road` — `CD-420322` Bentley safe-stop (unchanged).
- `driver_travel` — `lib/room/travel.ts`. Heroes `CD-420299` / `CD-420603` /
  `CD-420154`. Quote≠booking≠boarding; proposes a rebook for approval, never books,
  never moves the promise. Agent verified (reads → submit; draft holds the line).
- `pickup_readiness` — `lib/room/pickup.ts`. Hero `CD-420593` (BMW M4, "similar
  stock reference is not a VIN match"). Asks the site to reconcile the VIN, holds
  collection, never marks picked up, never substitutes. Agent verified.
- `promise_guardian` (the unique 5th) — `lib/room/promise.ts`. Hero `CD-420702`
  (window ended, car safe at yard, next release tomorrow). Flags the promise, tells
  stale vs real, proposes a revised date for approval, never writes a promise, never
  emails the customer. Agent verified.
- `driver_support` — `lib/room/support.ts`. Runs on the support inbox (its own
  thread-based surface + section + `app/api/support/[id]/{investigate,decide}`
  routes, not the per-order `kindFor`). 4 open threads: an impostor (`PENDING_IDENTITY`
  — reference belongs to another account), an ambiguous match (`PENDING_MATCH`), and
  two confirmed. The agent links with the cited basis, drafts a sourced reply, and —
  verified — **refuses to reveal any car/route/buyer/driver detail** for the
  unverified reference, asking the sender to confirm it. Standout case.

Room now shows **6 heroes** (road 1, travel 3, pickup 1, promise 1) + **4 support
threads** + ~37 triage rows. `/room` renders clean (200, ~1.5s warm). Shared helpers:
`lib/room/cite.ts`. Guards are intentionally conservative and self-correct (they may
refuse a safe negation like "do not release a similar"; the agent rewrites and the
refused draft is surfaced for transparency).

## Runtime — VERIFIED end-to-end (2026-10-24)

Ran against Docker Postgres + the seeded snapshot, with `MISTRAL_API_KEY` set:
- `GET /api/room` → 200. 1 hero (`CD-420322`, Bentley Continental GT, tone danger,
  driver Kasper Kovelund, delivery Hamburg) + 42 orders in "also waiting". Hero card
  has 12 cited facts (quoting the driver's real message), 4 missing, 2 already-done,
  and the three actions `ask-driver / hold-promise / owner-call`.
- `POST /api/orders/ord-00322/investigate` → `ok:true`. Live Mistral loop did the four
  reads then `submit_decision`. Its **first** driver draft was **refused** by the
  guard (mentioned "cleared it to drive"); it rewrote; the second draft passed and is
  surfaced. `refusedDraft` is shown in the UI for transparency.
- `POST /api/orders/ord-00322/decide` (ask-driver, approved) → effect: "Approved as
  the exact driver message. Nothing was sent, and the snapshot was not changed."
  Persisted to `room_activity` and visible in `room.decisions`.

Dev server left running at **http://localhost:3000** (open `/room`).

## Known issues / TODO

- **Cold start is slow; warm is fast.** Next 16 Turbopack dev: ~5 min to "Ready", and
  the first hit to each route compiles (~75s). But **once warm the app is snappy** —
  measured clean (no overlapping requests): `/api/room` 495ms, `/room` page 516ms,
  `/drive` 789ms, a live agent run (`/investigate`) 6.7s. (An earlier "20–28s" reading
  was an artifact of several concurrent probe loops, not real cost.) **For the demo:
  pre-warm** (boot early, click `/room`, `/drive`, an order, run the agent once) — or
  run `next build && next start` to remove per-request compile entirely.
- **`npm run attachments:seed` failed (exit 1)** — rustfs upload. Non-critical: only
  the order-files view uses it; the control room and agent do not. Needs a look
  (bucket creation / endpoint timing) before relying on the files tab.
- **Guard is slightly over-eager**: refuses a draft containing "drive" even in a safe
  negation like "nobody has cleared it to drive". Conservative and self-correcting
  (agent rewrites), but could special-case that phrase if desired.
- **Process story (30% of score)** is about how we used coding agents while building.
  Capture it as a scene for the 2–3 min video (kept/rejected prompts), not just prose.

## Superseded — safe to delete

- `backend/` (FastAPI + SQLite) and `frontend/` (Next 14) at the repo root are the
  **old invented-blueprint stack**. They work and typecheck but are NOT part of the
  deliverable. Delete before submission to avoid a confusing second stack. Left in
  place for now so nothing is removed from under a parallel agent.
- `scratchpad/DESIGN.md` (in the session scratchpad) is the original design doc,
  kept for reference only.
