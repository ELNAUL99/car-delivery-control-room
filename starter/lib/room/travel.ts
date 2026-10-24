// Driver Travel — a vehicle ferry/crossing at risk. The whole point is the
// distinction the records keep: a quote is not a booking, and a booking is not a
// boarding. The agent does the cheap work (read the options, the reservation, the
// promise, the prior attempt), proposes a booking for a person to approve, and
// never books or moves the delivery promise itself.

import { chosenWindows } from "@/lib/present/attention"
import { type Bundle, bool, num, obj, rows, str } from "@/lib/present/bundle"
import { label } from "@/lib/present/labels"
import { fmtDateTime, fmtMoney, fmtRange, relativeTo } from "@/lib/present/time"
import { EMPTY_PARAMETERS, fn, runAgent, textOf } from "@/lib/agent/run-agent"
import { fact, primaryVehicle } from "./cite"
import type { CaseKind, CitedFact, Investigation, RoomAction, RoomCard } from "./types"

type Slice = Record<string, unknown>

const TRAVEL_SIGNAL = /FERRY|CROSSING|IMPORT_TRAVEL|TRAVEL_DECISION/

// Detection uses only collections present on the lightweight board bundle
// (incidents, alerts), so it gives the same answer before and after a full load.
export function isOpenTravelCase(bundle: Bundle): boolean {
  const incident = rows(bundle, "incidents").some((row) => str(row.details.kind) === "TRAVEL_CAPACITY" && !str(row.details.resolved_at))
  const alert = bundle.alerts.some((a) => (a.status === "OPEN" || a.status === "ACKNOWLEDGED") && TRAVEL_SIGNAL.test(a.signal))
  return incident || alert
}

type TravelSlices = {
  orderId: string
  reference: string
  snapshotAt: string | null
  vehicle: string
  driver: string | null
  customer: string
  destinationCity: string
  zone: string | null
  options: Slice[]
  reservations: Slice[]
  alert: Slice | null
  incident: Slice | null
  promise: Slice | null
  proposals: Slice[]
  messages: Slice[]
}

function travelSlices(bundle: Bundle): TravelSlices | null {
  if (!isOpenTravelCase(bundle)) return null
  const assignment = rows(bundle, "work_assignments").find((row) => str(row.details.status) === "IN_PROGRESS")
    ?? rows(bundle, "work_assignments")[0]
  const driverId = assignment ? str(assignment.details.driver_id) : null
  const windows = chosenWindows(bundle)
  const delivery = bundle.places.get(bundle.order.deliveryAddressId)
  const alert = bundle.alerts.find((a) => (a.status === "OPEN" || a.status === "ACKNOWLEDGED") && TRAVEL_SIGNAL.test(a.signal)) ?? null
  const incident = rows(bundle, "incidents").find((row) => str(row.details.kind) === "TRAVEL_CAPACITY" && !str(row.details.resolved_at)) ?? null
  return {
    orderId: bundle.order.id,
    reference: bundle.order.reference,
    snapshotAt: bundle.snapshotAt,
    vehicle: primaryVehicle(bundle),
    driver: driverId ? bundle.dir.driverName(driverId) : null,
    customer: bundle.customer.name,
    destinationCity: delivery?.city ?? "the delivery",
    zone: windows.promise?.zone ?? null,
    options: rows(bundle, "travel_options")
      .map((row): Slice => ({ id: row.id, ...row.details }))
      .sort((a, b) => String(a.departure_at ?? "").localeCompare(String(b.departure_at ?? ""))),
    reservations: rows(bundle, "travel_reservations").map((row): Slice => ({ id: row.id, ...row.details })),
    alert: alert ? { id: alert.id, signal: alert.signal, status: alert.status, severity: alert.severity, summary: alert.summary, triggeredAt: alert.triggeredAt } : null,
    incident: incident ? { id: incident.id, kind: str(incident.details.kind), status: str(incident.details.status), openedAt: str(incident.details.opened_at), owner: bundle.dir.title(incident.details.owner) } : null,
    promise: windows.promise ? {
      id: rows(bundle, "time_windows").find((row) => str(row.details.purpose) === "CUSTOMER_DELIVERY_PROMISE" && bool(row.details.is_selected))?.id ?? null,
      start: windows.promise.start, end: windows.promise.end, zone: windows.promise.zone, sourceLabel: windows.promise.sourceLabel,
    } : null,
    proposals: rows(bundle, "agent_proposals")
      .filter((row) => String(str(row.details.command)).startsWith("travel."))
      .map((row) => proposalSlice(bundle, row.id, row.details)),
    messages: bundle.messages.slice().sort((a, b) => a.authoredAt.localeCompare(b.authoredAt)).map((m) => ({
      id: m.id, at: m.authoredAt, author: bundle.dir.resolve(m.details.author_id, m.authorType).name,
      channel: str(m.details.channel), visibility: str(m.details.visibility), body: m.body,
    })),
  }
}

function proposalSlice(bundle: Bundle, id: string, details: Record<string, unknown>): Slice {
  const review = obj(details.review)
  const execution = obj(details.execution)
  return {
    id, command: str(details.command), status: str(details.status), summary: str(details.summary), rationale: str(details.rationale),
    reviewDecision: str(review?.decision), reviewNote: str(review?.decision_note), reviewer: bundle.dir.title(review?.reviewer_id), reviewedAt: str(review?.reviewed_at),
    executionStatus: str(execution?.status), executionError: str(execution?.error),
  }
}

function optionLine(option: Slice, zone: string | null): string {
  const status = label(str(option.status))
  const note = str(option.capacity_note)
  const dep = fmtDateTime(str(option.departure_at), zone)
  const arr = fmtDateTime(str(option.arrival_at), zone)
  const cutoff = fmtDateTime(str(option.check_in_cutoff_at), zone)
  const price = fmtMoney(num(option.quote_cents), str(option.currency) ?? "EUR")
  const provider = str(option.provider)
  return `${provider ?? "Crossing"} ${str(option.from_city)}→${str(option.to_city)}: ${status}${note ? ` (${note})` : ""}. Departs ${dep}, arrives ${arr}, check-in by ${cutoff}.${price ? ` Quote ${price}.` : " No price quoted."}`
}

function reservationLine(res: Slice, zone: string | null): string {
  const boarding = label(str(res.boarding_confirmation))
  const checkIn = label(str(res.check_in_confirmation))
  const stateNote = obj(res.journey_state_basis) ? str(obj(res.journey_state_basis)?.note) : null
  const amend = obj(res.amendment_request)
  const amendNote = amend ? ` Amendment ${label(str(amend.requested_change))} is ${label(str(amend.status))}.` : ""
  return `Booking ${str(res.booking_reference)} is ${label(str(res.status))}, departs ${fmtDateTime(str(res.departure_at), zone)}. Boarding ${boarding}, check-in ${checkIn} — a booking is not a boarding.${stateNote ? ` ${stateNote}` : ""}${amendNote}`
}

function actionsFor(slices: TravelSlices, drafts?: { driver?: string; rebook?: string; promise?: string }): RoomAction[] {
  const quote = slices.options.find((o) => str(o.status) === "AVAILABLE_QUOTE") ?? slices.options.find((o) => str(o.status) !== "SOLD_OUT")
  const price = quote ? fmtMoney(num(quote.quote_cents), str(quote.currency) ?? "EUR") : null
  const dep = quote ? fmtDateTime(str(quote.departure_at), slices.zone) : null
  const cutoff = quote ? fmtDateTime(str(quote.check_in_cutoff_at), slices.zone) : null
  const promise = slices.promise ? fmtRange(str(slices.promise.start), str(slices.promise.end), str(slices.promise.zone)) : "the recorded promise"
  return [
    {
      id: "reply-driver",
      title: `Tell ${slices.driver ?? "the driver"} where the crossing stands`,
      whatChanges: "One driver-chat message in the exact text you approve. It does not book a crossing or change the pickup.",
      draft: drafts?.driver ?? `The overnight crossing came back sold out. The later sailing is a quote only — nothing is booked yet. Please hold your pickup and start time until we confirm the crossing and the plan.`,
      sendable: true,
    },
    {
      id: "propose-rebook",
      title: quote ? `Approve booking the later crossing${price ? ` (${price})` : ""}` : "Approve a rebook once a crossing is available",
      whatChanges: "Nothing is booked here. Approving records that you authorise this booking; the reservation is a separate, logged step, and the prior attempt FAILED with no reference.",
      draft: drafts?.rebook ?? (quote
        ? `Book ${str(quote.provider) ?? "the vehicle crossing"} departing ${dep}, check-in by ${cutoff}${price ? `, ${price}` : ""}, vehicle slot required. This is a quote, not a reservation — book only after approval.`
        : `No crossing is bookable yet. Re-check capacity before proposing a booking.`),
      sendable: false,
    },
    {
      id: "hold-promise",
      title: "Leave the customer delivery promise until they approve a later date",
      whatChanges: "No new delivery date is written. The customer said they must approve a later date before it is promised to the receiving contact.",
      draft: drafts?.promise ?? `Leave ${promise} as recorded. No new delivery time is set. A later date is proposed to the customer for approval, not written here.`,
      sendable: false,
    },
  ]
}

function cardFromSlices(slices: TravelSlices, source: RoomCard["source"] = "records", drafts?: { summary?: string; driver?: string; rebook?: string; promise?: string }): RoomCard {
  const facts: CitedFact[] = []

  // Quoted messages (ferry/route conversation).
  for (const m of slices.messages) {
    if (typeof m.id !== "string" || typeof m.body !== "string") continue
    const channel = typeof m.channel === "string" ? label(m.channel) : "Message"
    const visibility = m.visibility === "INTERNAL" ? "internal" : null
    facts.push(fact(`${m.author}: “${m.body}”`, [channel, visibility].filter(Boolean).join(" · "), m.id, "message", typeof m.at === "string" ? m.at : null))
  }
  if (slices.alert) facts.push(fact(`${label(String(slices.alert.signal))} is ${label(String(slices.alert.status))}. “${slices.alert.summary}”`, "Alert · travel", String(slices.alert.id), "alert", str(slices.alert.triggeredAt)))
  if (slices.incident) facts.push(fact(`${label(String(slices.incident.kind))} is ${label(String(slices.incident.status))}.`, `Incident${slices.incident.owner ? ` · ${slices.incident.owner}` : ""}`, String(slices.incident.id), "incident", str(slices.incident.openedAt)))
  for (const option of slices.options) facts.push(fact(optionLine(option, slices.zone), "Travel option", String(option.id), "reservation", str(option.checked_at)))
  for (const res of slices.reservations) facts.push(fact(reservationLine(res, slices.zone), "Travel reservation", String(res.id), "reservation", str(res.booked_at)))
  if (slices.promise && typeof slices.promise.id === "string") {
    const rel = relativeTo(str(slices.promise.end), slices.snapshotAt)
    facts.push(fact(`Delivery promise ${fmtRange(str(slices.promise.start), str(slices.promise.end), str(slices.promise.zone))}, ${slices.promise.sourceLabel}.${rel ? ` It ends ${rel.text} at the snapshot.` : ""} It has not been replaced.`, "Time window", slices.promise.id, "window", str(slices.promise.end)))
  }

  const alreadyDone: CitedFact[] = []
  for (const p of slices.proposals) {
    if (typeof p.id !== "string") continue
    const exec = p.executionStatus ? ` Execution: ${label(String(p.executionStatus))}${p.executionError ? ` — “${p.executionError}”` : ""}.` : ""
    const review = p.reviewDecision ? ` ${p.reviewer ?? "A person"} ${label(String(p.reviewDecision)).toLowerCase()} it${p.reviewNote ? `: “${p.reviewNote}”` : ""}.` : ""
    alreadyDone.push(fact(`${label(String(p.command))}: “${p.summary}”.${review}${exec}`, `Proposal · ${label(String(p.status))}`, p.id, "proposal", str(p.reviewedAt)))
  }

  const soldOut = slices.options.some((o) => str(o.status) === "SOLD_OUT")
  const booked = slices.reservations.some((r) => str(r.status) === "BOOKED")
  const boardingConfirmed = slices.reservations.some((r) => str(r.boarding_confirmation) === "CONFIRMED")
  const missing = [
    booked ? null : "No vehicle crossing is booked — the later sailing is a quote, not a reservation.",
    booked && !boardingConfirmed ? "A booking exists but boarding is unconfirmed — a booking is not a boarding." : null,
    slices.proposals.some((p) => str(p.executionStatus) === "FAILED") ? "The earlier auto-book FAILED with no confirmation reference." : null,
    "The customer has not approved a later delivery date, so the promise is unchanged.",
  ].filter((x): x is string => !!x)

  const headline = `${slices.vehicle}: the crossing is ${soldOut ? "sold out" : "at risk"}. Delivery to ${slices.destinationCity} depends on it.`
  const summary = drafts?.summary ?? `${slices.reference}. ${soldOut ? "The booked sailing came back sold out; " : ""}the later sailing is a quote only and the prior auto-book failed with no reference. Nothing is booked. The customer must approve a later date before any new promise.`

  return {
    kind: "driver_travel",
    kicker: "Crossing at risk",
    orderId: slices.orderId,
    headline,
    summary,
    missing,
    facts,
    alreadyDone,
    actions: actionsFor(slices, drafts),
    source,
  }
}

export function buildTravelCard(bundle: Bundle): RoomCard | null {
  const slices = travelSlices(bundle)
  return slices ? cardFromSlices(slices) : null
}

// --- guards ---------------------------------------------------------------

const BOOKED_CLAIM = /\b(booked|confirmed|secured|reserved|guaranteed)\b/
const TIME_CLAIM = /\b(eta|arrival time|delivery time|new delivery|delivered by|promised? (for|by))\b/

export function travelReplyProblem(text: string): string | null {
  const t = text.trim()
  if (t.length < 20) return "The message is too short to send."
  const lower = t.toLowerCase()
  if (BOOKED_CLAIM.test(lower.replace(/not (yet )?booked/g, "").replace(/nothing is booked/g, ""))) return "The message must not say the crossing is booked or confirmed — it is only a quote."
  if (TIME_CLAIM.test(lower)) return "The message must not state a new delivery time; the customer has not approved one."
  return null
}

function rebookProblem(text: string): string | null {
  const lower = text.trim().toLowerCase()
  if (BOOKED_CLAIM.test(lower.replace(/book only after|after approval|not a reservation|to be booked|propose/g, ""))) {
    return "The rebook text must read as a proposal to approve, not a statement that a crossing is already booked."
  }
  return null
}

function summaryProblem(text: string): string | null {
  const lower = text.trim().toLowerCase()
  if (lower.length < 40) return "The reading is too short."
  if (/(crossing|ferry|sailing) (is )?(booked|confirmed|secured)/.test(lower)) return "The reading claims a crossing is booked when the records show only a quote."
  if (/new delivery (date|time)|promised a new/.test(lower)) return "The reading claims a new delivery promise the records do not have."
  return null
}

// --- agent ----------------------------------------------------------------

const SYSTEM = `You are the Driver Travel agent for a car delivery desk. A vehicle ferry crossing is at risk and a person is waiting on one decision.

Use the tools to read the records, then call submit_decision once.

Rules:
- A quote is not a booking, and a booking is not a boarding. Never say a crossing is booked, confirmed or secured unless a reservation record shows a confirmed boarding. The records here show a quote and a failed attempt.
- Do not book anything. rebookProposal is a booking you propose for a person to approve; it is not a booking.
- Do not contact the customer. Do not state a new delivery date or ETA — the customer must approve a later date first.
- driverReply is a driver-chat message. It may say the overnight is sold out and the later sailing is only a quote, and ask the driver to hold pickup/start. It must not say the crossing is booked.
- Cite only what you read. Do not invent a price, a sailing or a terminal.`

function spec(slices: TravelSlices) {
  const base = cardFromSlices(slices)
  const tools = [
    fn("read_alert_and_incident", "The travel alert and the open travel-capacity incident.", EMPTY_PARAMETERS),
    fn("read_crossings", "Every crossing option (quoted/sold-out, price, cutoff) and any reservation with its boarding state.", EMPTY_PARAMETERS),
    fn("read_promise_and_messages", "The customer delivery promise and the order's messages.", EMPTY_PARAMETERS),
    fn("read_prior_proposals", "Earlier travel proposals, including the attempt that failed.", EMPTY_PARAMETERS),
    fn("submit_decision", "Submit the reading and the drafts. Call once, after the reads.", {
      type: "object",
      properties: {
        summary: { type: "string", description: "Two or three sentences: what is quoted, what failed, that nothing is booked and the promise is unchanged." },
        driverReply: { type: "string", description: "Driver-chat text. Sold-out + quote-only + hold pickup. Must not say booked." },
        rebookProposal: { type: "string", description: "The booking to propose for approval: sailing, time, cutoff, price. A proposal, not a booking." },
        promiseNote: { type: "string", description: "Why the delivery promise stays until the customer approves a later date." },
      },
      required: ["summary", "driverReply", "rebookProposal", "promiseNote"],
    }),
  ]
  const payload = (name: string): unknown => {
    if (name === "read_alert_and_incident") return { alert: slices.alert, incident: slices.incident }
    if (name === "read_crossings") return { options: slices.options, reservations: slices.reservations }
    if (name === "read_promise_and_messages") return { promise: slices.promise, messages: slices.messages }
    if (name === "read_prior_proposals") return { proposals: slices.proposals }
    return { error: "Unknown tool" }
  }
  const knownIds = [
    slices.alert?.id, slices.incident?.id, slices.promise?.id,
    ...slices.options.map((o) => o.id), ...slices.reservations.map((r) => r.id), ...slices.proposals.map((p) => p.id),
  ].filter((x): x is string => typeof x === "string")

  return {
    system: SYSTEM,
    task: `Order ${slices.orderId} (${slices.reference}). Read the alert, the crossings, the promise and the prior attempt, then submit_decision. Do not answer in prose.`,
    tools,
    readTools: ["read_alert_and_incident", "read_crossings", "read_promise_and_messages", "read_prior_proposals"] as const,
    submitTool: "submit_decision",
    knownIds,
    toolPayload: payload,
    base,
    validate(input: Record<string, unknown>): string | null {
      return travelReplyProblem(textOf(input.driverReply)) ?? rebookProblem(textOf(input.rebookProposal)) ?? summaryProblem(textOf(input.summary))
    },
    finalize(input: Record<string, unknown>): { card: RoomCard; refusedDraft: string | null } {
      const summary = !summaryProblem(textOf(input.summary)) ? textOf(input.summary).trim() : undefined
      const driverProblem = travelReplyProblem(textOf(input.driverReply))
      const driver = driverProblem ? undefined : textOf(input.driverReply).trim()
      const rebook = !rebookProblem(textOf(input.rebookProposal)) ? textOf(input.rebookProposal).trim() : undefined
      const card = cardFromSlices(slices, driver || summary || rebook ? "agent" : "records", { summary, driver, rebook, promise: textOf(input.promiseNote).trim() || undefined })
      card.facts = base.facts
      card.alreadyDone = base.alreadyDone
      card.missing = base.missing
      card.headline = base.headline
      if (!summary) card.summary = base.summary
      return { card, refusedDraft: driverProblem ? textOf(input.driverReply).trim() || null : null }
    },
  }
}

async function investigate(bundle: Bundle): Promise<Investigation> {
  const slices = travelSlices(bundle)
  if (!slices) throw new Error("This agent only handles an open vehicle crossing case.")
  return runAgent(spec(slices))
}

export const driverTravelKind: CaseKind = {
  id: "driver_travel",
  kicker: "Crossing at risk",
  label: "Driver Travel",
  priority: 20,
  detect: isOpenTravelCase,
  buildCard: buildTravelCard,
  investigate,
  actionIds: ["reply-driver", "propose-rebook", "hold-promise"],
  guardAction(actionId, text) {
    if (actionId === "reply-driver") return travelReplyProblem(text ?? "")
    return null
  },
}
