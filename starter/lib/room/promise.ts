// Promise Guardian — the proactive area. A customer delivery promise is at risk
// or has passed. The agent reads the promise window, the latest driver-app
// position and the site's words, tells apart a stale signal from a real miss, and
// brings one decision: propose a revised date for a person to approve. It never
// writes a new promise, never says the car is delivered, and never emails the
// customer. The best card here is the one a person never has to see.

import { chosenWindows, latestTracking } from "@/lib/present/attention"
import { type Bundle, bool, rows, str } from "@/lib/present/bundle"
import { label } from "@/lib/present/labels"
import { fmtDateTime, fmtRange, relativeTo } from "@/lib/present/time"
import { EMPTY_PARAMETERS, fn, runAgent, textOf } from "@/lib/agent/run-agent"
import { fact, placeLabel, primaryVehicle } from "./cite"
import type { AgentTurn, CaseKind, CitedFact, Investigation, RoomAction, RoomCard } from "./types"

type Slice = Record<string, unknown>

const PROMISE_SIGNAL = /DELIVERY_PROMISE_UNACHIEVABLE|PROMISE_AT_RISK/

export function isOpenPromiseCase(bundle: Bundle): boolean {
  return bundle.alerts.some((a) => (a.status === "OPEN" || a.status === "ACKNOWLEDGED") && PROMISE_SIGNAL.test(a.signal))
}

export function promiseHalt(bundle: Bundle): string | null {
  if (!isOpenPromiseCase(bundle)) return null
  if (bundle.events.some((event) => event.command === "vehicle.delivered")) {
    return "Agent stopped. A delivery is already recorded, so the model was not asked to write a new promise."
  }
  return null
}

type PromiseSlices = {
  orderId: string
  reference: string
  snapshotAt: string | null
  vehicle: string
  customer: string
  destination: string
  zone: string | null
  alert: Slice | null
  promise: Slice | null
  tracking: Slice | null
  delivered: boolean
  messages: Slice[]
}

function promiseSlices(bundle: Bundle): PromiseSlices | null {
  if (!isOpenPromiseCase(bundle)) return null
  const windows = chosenWindows(bundle)
  const tracking = latestTracking(bundle).direct
  const alert = bundle.alerts.find((a) => PROMISE_SIGNAL.test(a.signal)) ?? null
  const delivered = bundle.events.some((e) => e.command === "vehicle.delivered")
  return {
    orderId: bundle.order.id,
    reference: bundle.order.reference,
    snapshotAt: bundle.snapshotAt,
    vehicle: primaryVehicle(bundle),
    customer: bundle.customer.name,
    destination: placeLabel(bundle, bundle.order.deliveryAddressId),
    zone: windows.promise?.zone ?? null,
    alert: alert ? { id: alert.id, signal: alert.signal, status: alert.status, severity: alert.severity, summary: alert.summary, triggeredAt: alert.triggeredAt } : null,
    promise: windows.promise ? {
      id: rows(bundle, "time_windows").find((row) => str(row.details.purpose) === "CUSTOMER_DELIVERY_PROMISE" && bool(row.details.is_selected))?.id ?? null,
      start: windows.promise.start, end: windows.promise.end, zone: windows.promise.zone, sourceLabel: windows.promise.sourceLabel,
    } : null,
    tracking: tracking ? { eta: tracking.eta, observedAt: tracking.observedAt, quality: tracking.quality, remainingKm: tracking.remainingKm, source: tracking.source } : null,
    delivered,
    messages: bundle.messages.slice().sort((a, b) => a.authoredAt.localeCompare(b.authoredAt)).map((m) => ({
      id: m.id, at: m.authoredAt, author: bundle.dir.resolve(m.details.author_id, m.authorType).name, channel: str(m.details.channel), visibility: str(m.details.visibility), body: m.body,
    })),
  }
}

function actionsFor(slices: PromiseSlices, drafts?: { flag?: string; revised?: string; customer?: string }): RoomAction[] {
  const range = slices.promise ? fmtRange(str(slices.promise.start), str(slices.promise.end), str(slices.promise.zone)) : "the recorded promise"
  return [
    {
      id: "flag-hold",
      title: "Flag the promise as unachievable; do not silently change it",
      whatChanges: `Nothing is written. ${range} stays on the order. Approving records that it cannot be met and must not be quietly overwritten.`,
      draft: drafts?.flag ?? `The promise ${range} cannot be met. Keep it on the record, flagged, until a revised date is approved. Do not overwrite it silently.`,
      sendable: false,
    },
    {
      id: "propose-revised",
      title: "Propose a revised delivery date for approval",
      whatChanges: "Nothing is written. Approving records that you authorise proposing this revised date; the new promise is only set after the customer agrees.",
      draft: drafts?.revised ?? `Propose a revised delivery from the next confirmed release window. This is a proposal for approval, not a new promise — the customer must agree before it is set.`,
      sendable: false,
    },
    {
      id: "customer-call",
      title: `The call to ${slices.customer} is yours`,
      whatChanges: "No email is sent. Approving records that you will tell the customer the original window is missed and agree a revised date.",
      draft: drafts?.customer ?? `${slices.customer}: the ${range} window will be missed. The car is safe. We would like to agree a revised delivery date before we promise one to the receiving contact.`,
      sendable: false,
    },
  ]
}

function cardFromSlices(slices: PromiseSlices, source: RoomCard["source"] = "records", drafts?: { summary?: string; flag?: string; revised?: string; customer?: string }): RoomCard {
  const facts: CitedFact[] = []
  for (const m of slices.messages) {
    if (typeof m.id !== "string" || typeof m.body !== "string") continue
    const channel = typeof m.channel === "string" ? label(m.channel) : "Message"
    const visibility = m.visibility === "INTERNAL" ? "internal" : null
    facts.push(fact(`${m.author}: “${m.body}”`, [channel, visibility].filter(Boolean).join(" · "), m.id, "message", typeof m.at === "string" ? m.at : null, "reported"))
  }
  if (slices.alert && typeof slices.alert.id === "string") facts.push(fact(`${label(String(slices.alert.signal))} is ${label(String(slices.alert.status))}. “${slices.alert.summary}”`, "Alert · promise", slices.alert.id, "alert", str(slices.alert.triggeredAt), "reported"))
  if (slices.promise && typeof slices.promise.id === "string") {
    const rel = relativeTo(str(slices.promise.end), slices.snapshotAt)
    facts.push(fact(`Delivery promise ${fmtRange(str(slices.promise.start), str(slices.promise.end), str(slices.promise.zone))}, ${slices.promise.sourceLabel}.${rel ? ` It ends ${rel.text} at the snapshot.` : ""} It has not been replaced.`, "Time window", slices.promise.id, "window", str(slices.promise.end), "recorded"))
  }
  if (slices.tracking) {
    const observed = fmtDateTime(str(slices.tracking.observedAt), slices.zone)
    const eta = fmtDateTime(str(slices.tracking.eta), slices.zone)
    facts.push(fact(`Last driver-app position is ${label(String(slices.tracking.quality))}${observed ? ` at ${observed}` : ""}${typeof slices.tracking.remainingKm === "number" ? `, ${slices.tracking.remainingKm} km to go` : ""}${eta ? `, that observation's ETA ${eta}` : ""}. Read whether this is current or stale before acting.`, "Tracking", "tracking", "tracking", str(slices.tracking.observedAt), String(slices.tracking.quality).toUpperCase() === "STALE" ? "stale" : "reported"))
  }

  const missing = [
    "No revised customer delivery promise is approved.",
    "The next confirmed release window is not yet turned into an agreed date.",
    `${slices.customer} has not agreed a revised delivery date.`,
    "This card does not write a new promise.",
  ]
  const headline = `${slices.vehicle}: the delivery promise to ${slices.destination} will be missed. No revised date is approved.`
  const summary = drafts?.summary ?? `${slices.reference}. ${slices.alert ? `“${slices.alert.summary}” ` : ""}The car is safe but the window is unachievable. Propose a revised date for approval — do not write a new promise, and do not tell the customer a new time until they agree.`

  return {
    kind: "promise_guardian",
    kicker: "Promise at risk",
    orderId: slices.orderId,
    headline,
    summary,
    missing,
    facts,
    alreadyDone: [],
    actions: actionsFor(slices, drafts),
    source,
  }
}

export function buildPromiseCard(bundle: Bundle): RoomCard | null {
  const slices = promiseSlices(bundle)
  return slices ? cardFromSlices(slices) : null
}

// --- guards ---------------------------------------------------------------

function summaryProblem(text: string): string | null {
  const lower = text.trim().toLowerCase()
  if (lower.length < 40) return "The reading is too short."
  if (/delivered|handed over to the customer/.test(lower.replace(/not delivered/g, ""))) return "The reading claims the car is delivered."
  if (/new (promise|date) (is )?(set|approved|confirmed)|promised a new/.test(lower)) return "The reading claims a revised promise is set when none is approved."
  return null
}

// --- agent ----------------------------------------------------------------

const SYSTEM = `You are the Promise Guardian for a car delivery desk. A customer delivery promise is at risk or has passed, and a person is waiting on one decision.

Use the tools to read the records, then call submit_decision once.

Rules:
- Tell apart a stale signal from a real miss. The last driver-app position may be old; say so rather than treating it as current.
- Do not write a new delivery promise. revisedProposal is a date you propose for a person to approve; it is not a new promise.
- Do not say the car is delivered. Do not contact the customer. customerScript is words a person may say; it is not an email.
- Cite only what you read. Do not invent a release time, an ETA, or a new date.`

function spec(slices: PromiseSlices, note?: string, history?: AgentTurn[]) {
  const base = cardFromSlices(slices)
  const tools = [
    fn("read_alert", "The promise alert and its summary.", EMPTY_PARAMETERS),
    fn("read_promise_and_tracking", "The customer delivery promise window and the latest driver-app position.", EMPTY_PARAMETERS),
    fn("read_messages", "Every message on this order, oldest first.", EMPTY_PARAMETERS),
    fn("submit_decision", "Submit the reading and the drafts. Call once, after the reads.", {
      type: "object",
      properties: {
        summary: { type: "string", description: "Two or three sentences: why the promise is missed, stale vs real, and that no new promise is set." },
        flagNote: { type: "string", description: "Why the original promise stays on the record, flagged, not overwritten." },
        revisedProposal: { type: "string", description: "The revised date to propose for approval. A proposal, not a new promise." },
        customerScript: { type: "string", description: "What a person can say to the customer to agree a revised date. Not an email you send." },
        say: { type: "string", description: "One or two sentences back to the person. Refuse to contact the customer yourself. The call stays with them." },
      },
      required: ["summary", "flagNote", "revisedProposal", "customerScript"],
    }),
  ]
  const payload = (name: string): unknown => {
    if (name === "read_alert") return { alert: slices.alert }
    if (name === "read_promise_and_tracking") return { promise: slices.promise, tracking: slices.tracking, snapshotAt: slices.snapshotAt }
    if (name === "read_messages") return { messages: slices.messages }
    return { error: "Unknown tool" }
  }
  const knownIds = [slices.alert?.id, slices.promise?.id, ...slices.messages.map((m) => m.id)].filter((x): x is string => typeof x === "string")
  return {
    system: SYSTEM,
    task: `Order ${slices.orderId} (${slices.reference}). Read the alert, the promise and tracking, and the messages, then submit_decision. Do not answer in prose.`,
    tools,
    readTools: ["read_alert", "read_promise_and_tracking", "read_messages"] as const,
    submitTool: "submit_decision",
    knownIds,
    toolPayload: payload,
    base,
    note,
    history,
    validate(input: Record<string, unknown>): string | null {
      return summaryProblem(textOf(input.summary))
    },
    finalize(input: Record<string, unknown>): { card: RoomCard; refusedDraft: string | null } {
      const summary = !summaryProblem(textOf(input.summary)) ? textOf(input.summary).trim() : undefined
      const card = cardFromSlices(slices, summary ? "agent" : "records", {
        summary, flag: textOf(input.flagNote).trim() || undefined, revised: textOf(input.revisedProposal).trim() || undefined, customer: textOf(input.customerScript).trim() || undefined,
      })
      card.facts = base.facts
      card.alreadyDone = base.alreadyDone
      card.missing = base.missing
      card.headline = base.headline
      if (!summary) card.summary = base.summary
      return { card, refusedDraft: null }
    },
  }
}

async function investigate(bundle: Bundle, note?: string, history?: AgentTurn[]): Promise<Investigation> {
  const slices = promiseSlices(bundle)
  if (!slices) throw new Error("This agent only handles an at-risk delivery promise.")
  return runAgent(spec(slices, note, history))
}

export const promiseGuardianKind: CaseKind = {
  id: "promise_guardian",
  kicker: "Promise at risk",
  label: "Promise Guardian",
  priority: 40,
  detect: isOpenPromiseCase,
  buildCard: buildPromiseCard,
  investigate,
  halt: promiseHalt,
  actionIds: ["flag-hold", "propose-revised", "customer-call"],
  guardAction() {
    return null
  },
}
