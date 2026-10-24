# ControlRoom — Bahn car delivery

A control room where agents do the legwork and a person is handed only the one
decision that needs them. Built for Bahn's Prompt Operations Hackathon, 24–25
October 2026, on Bahn's own starter and the real fictional snapshot
(`2026-10-21T09:00:00Z`, 100 orders).

> The home page `/` is a short **onboarding** of how the room works; **`/room`**
> ("To decide") is the control room itself. The lane board (how people work today)
> moved to `/board`, and `/drive` shows the driver's phone.

## What it does

The room reads the whole fleet and surfaces only the orders waiting on a person.
Every card cites the records it is built from (a message, an alert, a booking),
shows what is still missing, and offers a small number of **separate** decisions —
each approved on its own. Approving records a decision; it **sends nothing** and
**never changes the snapshot**, and the case stays open until the facts are in.

Behind each area is a **real tool-using agent** (an LLM in a loop). It does the
cheap work first — read the order, the messages, the alert, the booking — then
either brings one decision or stops when a fact is missing. Hard rules are enforced
in code (a guard refuses a draft before anyone can approve it), and without a model
key the card falls back to the plain reading of the records.

### Five areas, each done for real

| Area | Example order | The decision |
| --- | --- | --- |
| **On the Road** | `CD-420322` | Bentley stopped, driver safe. Ask for the place + a photo, hold the promise, owner call. No mechanical advice; never clears the car to drive. |
| **Driver Travel** | `CD-420299` | Ferry sold out; the later sailing is a **quote, not a booking** (and a booking is not a boarding). Proposes a rebook for approval; never books, never moves the promise. |
| **Pickup Readiness** | `CD-420593` | The site has "a similar car". A similar stock reference is **not a VIN match** — confirm the exact VIN, hold collection, never substitute. |
| **Promise Guardian** | `CD-420702` | Nobody reported this. A delivery promise that will be missed, surfaced before the angry call, with a revised date drafted for approval. The card you never have to see. |
| **Driver Support** | support inbox | Links a message to its order with the cited basis, answers routine questions from the record — and **refuses to reveal any detail for a reference that belongs to another account**, asking the sender to verify. |

The agent never contacts a customer on its own: customer-facing steps are scripts a
person makes the call on. Drivers and sites are fine to message, and only in the
exact text a person approves.

## How we worked with AI (and what we threw away)

The first blueprint was an invented world — `CAR-2391`, "Hans Müller", ADAC, a
separate Python/SQLite service, five faked areas, and a one-click button that
emailed the customer and booked roadside assistance in a single tap. A
packet-grounded critique killed it: it ignored the real dataset, bundled exactly
the actions the brief says a person must approve one by one, and ran on a private
fiction a judge who knows the packet would spot.

So it was **thrown out and rebuilt on the real starter and the real records**: the
decision cards are the snapshot's own `agent_proposals`, alerts and messages; the
five areas are real agents with guardrails; approval is per-action and the case
stays open. The pivot — and the prompts kept vs. discarded — is the story in the
demo.

## Architecture

- `starter/` — the app (Next.js 16 + Drizzle + Postgres), Bahn's starter extended.
- `starter/lib/room/` — the control room: a **case-kind registry** (`kinds.ts`);
  one module per area (`on-the-road.ts`, `travel.ts`, `pickup.ts`, `promise.ts`,
  `support.ts`); the queue (`load.ts`, `queue.ts`); cited-fact helpers (`cite.ts`).
- `starter/lib/agent/` — a shared tool-use loop (`run-agent.ts`), the approval
  guards (`guard.ts`), and the session store (`session.ts`, table `room_activity`,
  no foreign key so reseeding the snapshot never depends on it).
- `starter/app/room/`, `app/drive/`, `app/components/room-view.tsx` — the UI and the
  driver's-phone view that shows an approved message is **not** sent.
- `starter/app/api/orders/[id]/{investigate,decide}` and `app/api/support/[id]/…`
  — run the agent and record decisions.

## Run from a fresh clone

Needs Node.js 24+ and Docker.

```sh
cd starter
cp .env.example .env            # optional: set MISTRAL_API_KEY to turn on the live agent
docker compose up -d --wait     # Postgres on :5438, object store on :9009
npm ci
npm run db:push                 # schema, incl. room_activity
npm run db:seed                 # 100 orders + ~4,400 records
npm run attachments:seed        # optional — only the order Files tab uses it
npm run dev                     # http://localhost:3000/room  (Next 16 first boot is slow)
```

Without `MISTRAL_API_KEY`, the room still works end to end — each card shows the
reading of the records, and "Look again with the agent" says so. With the key, the
agent reasons live and its tool trace is shown on the card.

## How it maps to the judging

- **The control room (40%)** — only the orders that need a person; every fact cited
  to its record; the agent does the cheap work first, stops when it should, and
  hands over what it found; after a decision it is clear what happens next (and that
  nothing was sent).
- **How you worked with AI (30%)** — the pivot above; the agent is a real loop with
  guardrails, and the refused drafts are shown rather than hidden.
- **Taste (30%)** — quiet by default, plain language for ops (no dev-tool JSON),
  cited evidence, and an empty state that says so.

Everything in the packet and this repo is fictional.
