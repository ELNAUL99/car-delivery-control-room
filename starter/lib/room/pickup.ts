// Pickup Readiness — a driver is at the site but the car's identity or release is
// unresolved (an empty-pickup attempt). The rule the records keep: a similar stock
// reference is not a VIN match. The agent reads the identity, the site's words and
// the prior proposal, asks the site to reconcile the VIN, and holds collection. It
// never marks the car picked up and never authorises a substitute.

import { type Bundle, bool, obj, rows, str } from "@/lib/present/bundle"
import { label } from "@/lib/present/labels"
import { EMPTY_PARAMETERS, fn, runAgent, textOf } from "@/lib/agent/run-agent"
import { fact, placeLabel, primaryVehicle } from "./cite"
import type { CaseKind, CitedFact, Investigation, RoomAction, RoomCard } from "./types"

type Slice = Record<string, unknown>

export function isOpenPickupCase(bundle: Bundle): boolean {
  const incident = rows(bundle, "incidents").some((row) => str(row.details.kind) === "EMPTY_PICKUP" && !str(row.details.resolved_at))
  const alert = bundle.alerts.some((a) => (a.status === "OPEN" || a.status === "ACKNOWLEDGED") && a.signal === "EMPTY_PICKUP")
  return incident || alert
}

type PickupSlices = {
  orderId: string
  reference: string
  snapshotAt: string | null
  vehicle: string
  vin: string | null
  registration: string | null
  driver: string | null
  customer: string
  pickupPlace: string
  incident: Slice | null
  alert: Slice | null
  proposal: Slice | null
  endpoint: Slice | null
  messages: Slice[]
}

function pickupSlices(bundle: Bundle): PickupSlices | null {
  if (!isOpenPickupCase(bundle)) return null
  const primary = bundle.items.find((item) => item.role === "PRIMARY") ?? bundle.items[0] ?? null
  const assignment = rows(bundle, "work_assignments").find((row) => str(row.details.status) === "IN_PROGRESS") ?? rows(bundle, "work_assignments")[0]
  const driverId = assignment ? str(assignment.details.driver_id) : null
  const incident = rows(bundle, "incidents").find((row) => str(row.details.kind) === "EMPTY_PICKUP" && !str(row.details.resolved_at)) ?? null
  const alert = bundle.alerts.find((a) => a.signal === "EMPTY_PICKUP") ?? null
  const proposal = rows(bundle, "agent_proposals").find((row) => String(str(row.details.command)).startsWith("pickup.")) ?? null
  const endpoint = rows(bundle, "order_endpoint_details").find((row) => str(row.details.boundary) === "PICKUP") ?? null
  return {
    orderId: bundle.order.id,
    reference: bundle.order.reference,
    snapshotAt: bundle.snapshotAt,
    vehicle: primaryVehicle(bundle),
    vin: primary?.vehicle.vin ?? null,
    registration: primary?.vehicle.registration ?? null,
    driver: driverId ? bundle.dir.driverName(driverId) : null,
    customer: bundle.customer.name,
    pickupPlace: placeLabel(bundle, bundle.order.pickupAddressId),
    incident: incident ? { id: incident.id, kind: str(incident.details.kind), status: str(incident.details.status), openedAt: str(incident.details.opened_at), owner: bundle.dir.title(incident.details.owner) } : null,
    alert: alert ? { id: alert.id, signal: alert.signal, status: alert.status, summary: alert.summary, triggeredAt: alert.triggeredAt } : null,
    proposal: proposal ? {
      id: proposal.id, command: str(proposal.details.command), status: str(proposal.details.status), summary: str(proposal.details.summary), rationale: str(proposal.details.rationale),
      payload: obj(proposal.details.proposed_payload), reviewNote: str(obj(proposal.details.review)?.decision_note),
    } : null,
    endpoint: endpoint ? { id: endpoint.id, accessStatus: str(endpoint.details.access_status), contactStatus: str(endpoint.details.contact_status), instruction: str(endpoint.details.access_instruction) } : null,
    messages: bundle.messages.slice().sort((a, b) => a.authoredAt.localeCompare(b.authoredAt)).map((m) => ({
      id: m.id, at: m.authoredAt, author: bundle.dir.resolve(m.details.author_id, m.authorType).name, channel: str(m.details.channel), visibility: str(m.details.visibility), body: m.body,
    })),
  }
}

function actionsFor(slices: PickupSlices, drafts?: { site?: string; hold?: string; customer?: string }): RoomAction[] {
  const vin = slices.vin ?? "the recorded VIN"
  return [
    {
      id: "ask-site",
      title: `Ask ${slices.pickupPlace} to reconcile the VIN before any handover`,
      whatChanges: "One message to the pickup site in the exact text you approve. It does not release the car or mark it picked up.",
      draft: drafts?.site ?? `Please match VIN ${vin} for the ${slices.vehicle} against your release queue before any handover. A similar stock reference is not proof of identity — do not release a different car. We are holding collection until the exact vehicle is confirmed.`,
      sendable: true,
    },
    {
      id: "hold-collection",
      title: "Keep collection on hold; do not mark the car picked up",
      whatChanges: "Nothing is written. The pickup event stays unset. Approving records that the car is not collected until its identity is confirmed.",
      draft: drafts?.hold ?? `Hold collection. The pickup event stays unset while the site and customer reconcile the record. No car is handed over on a similar stock reference.`,
      sendable: false,
    },
    {
      id: "customer-reconcile",
      title: `The call to ${slices.customer} is yours`,
      whatChanges: "No message is sent to the customer. The customer said not to substitute a car and is checking which branch holds it. Approving records that you will follow up with them.",
      draft: drafts?.customer ?? `${slices.customer}: your driver is on site but the branch cannot find the ${slices.vehicle} (VIN ${vin}) in its release queue, only a similar stock reference. Which branch holds this exact car? We will not substitute a different one.`,
      sendable: false,
    },
  ]
}

function cardFromSlices(slices: PickupSlices, source: RoomCard["source"] = "records", drafts?: { summary?: string; site?: string; hold?: string; customer?: string }): RoomCard {
  const facts: CitedFact[] = []
  for (const m of slices.messages) {
    if (typeof m.id !== "string" || typeof m.body !== "string") continue
    const channel = typeof m.channel === "string" ? label(m.channel) : "Message"
    const visibility = m.visibility === "INTERNAL" ? "internal" : null
    facts.push(fact(`${m.author}: “${m.body}”`, [channel, visibility].filter(Boolean).join(" · "), m.id, "message", typeof m.at === "string" ? m.at : null))
  }
  if (slices.vin) facts.push(fact(`Ordered vehicle is a ${slices.vehicle}, VIN ${slices.vin}${slices.registration ? `, reg ${slices.registration}` : ""}. Identity must match this, not a similar stock reference.`, "Vehicle", slices.orderId, "work", null))
  if (slices.alert && typeof slices.alert.id === "string") facts.push(fact(`${label(String(slices.alert.signal))} is ${label(String(slices.alert.status))}. “${slices.alert.summary}”`, "Alert · pickup", slices.alert.id, "alert", str(slices.alert.triggeredAt)))
  if (slices.incident && typeof slices.incident.id === "string") facts.push(fact(`${label(String(slices.incident.kind))} is ${label(String(slices.incident.status))}.`, `Incident${slices.incident.owner ? ` · ${slices.incident.owner}` : ""}`, slices.incident.id, "incident", str(slices.incident.openedAt)))
  if (slices.endpoint && typeof slices.endpoint.id === "string") facts.push(fact(`Pickup access is ${label(String(slices.endpoint.accessStatus))}, contact ${label(String(slices.endpoint.contactStatus))}.${slices.endpoint.instruction ? ` “${slices.endpoint.instruction}”` : ""}`, "Pickup endpoint", slices.endpoint.id, "document", null))

  const alreadyDone: CitedFact[] = []
  if (slices.proposal && typeof slices.proposal.id === "string") {
    const p = slices.proposal
    const payload = obj(p.payload)
    const holds = payload ? [bool(payload.do_not_mark_picked_up) ? "do not mark picked up" : null, bool(payload.hold_collection) ? "hold collection" : null].filter(Boolean).join(", ") : ""
    alreadyDone.push(fact(`${label(String(p.command))}: “${p.summary}”. ${p.rationale ?? ""}${holds ? ` Proposed: ${holds}.` : ""}`, `Proposal · ${label(String(p.status))}`, String(p.id), "proposal", null))
  }

  const missing = [
    "The car's identity is not confirmed — only a similar stock reference is on site.",
    "Which branch holds the exact VIN is not established.",
    `${slices.customer} has not confirmed the release location.`,
    "The pickup is not marked, and this card does not mark it.",
  ]
  const headline = `${slices.vehicle} not found at ${slices.pickupPlace}. ${slices.driver ?? "The driver"} is waiting; identity is unconfirmed.`
  const summary = drafts?.summary ?? `${slices.reference}. The site has a similar stock reference, not a VIN match, and ${slices.customer} says not to substitute. Collection is paused. Do not mark the car picked up.`

  return {
    kind: "pickup_readiness",
    kicker: "Pickup unresolved",
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

export function buildPickupCard(bundle: Bundle): RoomCard | null {
  const slices = pickupSlices(bundle)
  return slices ? cardFromSlices(slices) : null
}

// --- guards ---------------------------------------------------------------

export function siteMessageProblem(text: string): string | null {
  const t = text.trim()
  if (t.length < 20) return "The message is too short to send."
  const lower = t.toLowerCase()
  if (/\b(release|hand over|handover|collect|pick ?up) (the |a )?(similar|other|different|substitute)/.test(lower)) return "The message must not authorise releasing a similar or substitute car."
  if (/\b(picked up|collected|handover complete|marked picked)\b/.test(lower)) return "The message must not say the car is picked up."
  if (!/\bvin\b|identity|exact/.test(lower)) return "Ask the site to confirm the exact VIN or identity."
  return null
}

function summaryProblem(text: string): string | null {
  const lower = text.trim().toLowerCase()
  if (lower.length < 40) return "The reading is too short."
  if (/picked up|collected|handed over|substituted/.test(lower.replace(/not (yet )?(picked up|collected)/g, "").replace(/do not substitute/g, ""))) return "The reading claims the car was collected or substituted."
  return null
}

// --- agent ----------------------------------------------------------------

const SYSTEM = `You are the Pickup Readiness agent for a car delivery desk. A driver is at the site but the vehicle's identity or release is unresolved.

Use the tools to read the records, then call submit_decision once.

Rules:
- A similar stock reference is not a VIN match. Never authorise releasing a similar or substitute car.
- Do not mark the car picked up or collected. Collection stays on hold.
- Do not contact the customer. customerScript is words a person may say to the customer; it is not a message you send.
- siteMessage is a message to the pickup site. Ask it to confirm the exact VIN before any handover. It must not release a car.
- Cite only what you read. Do not invent a branch, a VIN, or a release location.`

function spec(slices: PickupSlices) {
  const base = cardFromSlices(slices)
  const tools = [
    fn("read_identity", "The ordered vehicle, its VIN, and the pickup endpoint access/contact status.", EMPTY_PARAMETERS),
    fn("read_messages", "Every message on this order, oldest first.", EMPTY_PARAMETERS),
    fn("read_incident_and_alert", "The empty-pickup incident and the pickup alert.", EMPTY_PARAMETERS),
    fn("read_prior_proposal", "The earlier pickup proposal and what it proposed.", EMPTY_PARAMETERS),
    fn("submit_decision", "Submit the reading and the drafts. Call once, after the reads.", {
      type: "object",
      properties: {
        summary: { type: "string", description: "Two or three sentences: identity unconfirmed, similar reference is not a match, collection on hold." },
        siteMessage: { type: "string", description: "Message to the site: confirm the exact VIN before any handover; do not release a similar car." },
        customerScript: { type: "string", description: "What a person can say to the customer to confirm the release branch. Not a message you send." },
        holdNote: { type: "string", description: "Why collection stays on hold and the pickup is not marked." },
      },
      required: ["summary", "siteMessage", "customerScript", "holdNote"],
    }),
  ]
  const payload = (name: string): unknown => {
    if (name === "read_identity") return { vehicle: slices.vehicle, vin: slices.vin, registration: slices.registration, endpoint: slices.endpoint }
    if (name === "read_messages") return { messages: slices.messages }
    if (name === "read_incident_and_alert") return { incident: slices.incident, alert: slices.alert }
    if (name === "read_prior_proposal") return { proposal: slices.proposal }
    return { error: "Unknown tool" }
  }
  const knownIds = [slices.alert?.id, slices.incident?.id, slices.proposal?.id, slices.endpoint?.id, ...slices.messages.map((m) => m.id)].filter((x): x is string => typeof x === "string")
  return {
    system: SYSTEM,
    task: `Order ${slices.orderId} (${slices.reference}). Read the identity, the messages, the incident and the prior proposal, then submit_decision. Do not answer in prose.`,
    tools,
    readTools: ["read_identity", "read_messages", "read_incident_and_alert", "read_prior_proposal"] as const,
    submitTool: "submit_decision",
    knownIds,
    toolPayload: payload,
    base,
    validate(input: Record<string, unknown>): string | null {
      return siteMessageProblem(textOf(input.siteMessage)) ?? summaryProblem(textOf(input.summary))
    },
    finalize(input: Record<string, unknown>): { card: RoomCard; refusedDraft: string | null } {
      const summary = !summaryProblem(textOf(input.summary)) ? textOf(input.summary).trim() : undefined
      const siteProblem = siteMessageProblem(textOf(input.siteMessage))
      const site = siteProblem ? undefined : textOf(input.siteMessage).trim()
      const card = cardFromSlices(slices, site || summary ? "agent" : "records", { summary, site, hold: textOf(input.holdNote).trim() || undefined, customer: textOf(input.customerScript).trim() || undefined })
      card.facts = base.facts
      card.alreadyDone = base.alreadyDone
      card.missing = base.missing
      card.headline = base.headline
      if (!summary) card.summary = base.summary
      return { card, refusedDraft: siteProblem ? textOf(input.siteMessage).trim() || null : null }
    },
  }
}

async function investigate(bundle: Bundle): Promise<Investigation> {
  const slices = pickupSlices(bundle)
  if (!slices) throw new Error("This agent only handles an open empty-pickup case.")
  return runAgent(spec(slices))
}

export const pickupReadinessKind: CaseKind = {
  id: "pickup_readiness",
  kicker: "Pickup unresolved",
  label: "Pickup Readiness",
  priority: 30,
  detect: isOpenPickupCase,
  buildCard: buildPickupCard,
  investigate,
  actionIds: ["ask-site", "hold-collection", "customer-reconcile"],
  guardAction(actionId, text) {
    return actionId === "ask-site" ? siteMessageProblem(text ?? "") : null
  },
}
