// The On the Road case, read off the snapshot. Quotes and field values come from
// the records. The three actions are separate: a driver message, a promise that
// is left alone, and a call the person makes themselves.

import { driverDraftProblem, summaryProblem } from "@/lib/agent/guard"
import { chosenWindows, latestTracking } from "@/lib/present/attention"
import { type Bundle, bool, num, obj, rows, str } from "@/lib/present/bundle"
import { label } from "@/lib/present/labels"
import { fmtDateTime, fmtRange, relativeTo } from "@/lib/present/time"
import type { ActionId, CitedFact, OnTheRoadCard, RoomAction } from "./types"

type Slice = Record<string, unknown>

export type RoadSlices = {
  orderId: string
  reference: string
  snapshotAt: string | null
  vehicle: string
  driver: string | null
  customer: string
  origin: string
  destination: string
  destinationCity: string
  messages: Slice[]
  incident: Slice | null
  alerts: Slice[]
  tracking: Slice | null
  promise: Slice | null
  proposal: Slice | null
  work: Slice | null
  documents: Slice[]
}

export function isOpenVehicleWarning(bundle: Bundle): boolean {
  return rows(bundle, "incidents").some((row) => str(row.details.kind) === "VEHICLE_WARNING" && !str(row.details.resolved_at))
}

export function roadHalt(bundle: Bundle): string | null {
  if (!isOpenVehicleWarning(bundle)) return null
  const safe = bundle.messages.some((message) => message.authorType === "driver" && /\b(safe|stopped)\b/i.test(message.body))
  if (!safe) return "Agent stopped. The driver has not confirmed a safe stop, so the model was not asked what to do with the car."
  return null
}

export function knownRecordIds(slices: RoadSlices): Set<string> {
  const ids = new Set<string>()
  for (const message of slices.messages) if (typeof message.id === "string") ids.add(message.id)
  if (typeof slices.incident?.id === "string") ids.add(slices.incident.id)
  for (const alert of slices.alerts) if (typeof alert.id === "string") ids.add(alert.id)
  if (typeof slices.tracking?.id === "string") ids.add(slices.tracking.id)
  if (typeof slices.promise?.id === "string") ids.add(slices.promise.id)
  if (typeof slices.proposal?.id === "string") ids.add(slices.proposal.id)
  if (typeof slices.work?.id === "string") ids.add(slices.work.id)
  for (const document of slices.documents) if (typeof document.id === "string") ids.add(document.id)
  return ids
}

export function roadSlices(bundle: Bundle): RoadSlices | null {
  const incident = rows(bundle, "incidents").find((row) => str(row.details.kind) === "VEHICLE_WARNING" && !str(row.details.resolved_at))
  if (!incident) return null
  const primary = bundle.items.find((item) => item.role === "PRIMARY") ?? bundle.items[0] ?? null
  const pickup = bundle.places.get(bundle.order.pickupAddressId)
  const delivery = bundle.places.get(bundle.order.deliveryAddressId)
  const assignment = rows(bundle, "work_assignments").find((row) => str(row.details.status) === "IN_PROGRESS")
    ?? rows(bundle, "work_assignments")[0]
  const driverId = assignment ? str(assignment.details.driver_id) : null
  const windows = chosenWindows(bundle)
  const tracking = latestTracking(bundle).direct
  const proposal = rows(bundle, "agent_proposals").find((row) => str(row.details.command) === "driver.request_safe_stop_details")
    ?? rows(bundle, "agent_proposals")[0]
  const work = rows(bundle, "work_items").find((row) => str(row.details.status) === "OPEN" && str(row.details.kind) === "VEHICLE_RECOVERY_DECISION")
    ?? rows(bundle, "work_items").find((row) => str(row.details.status) === "OPEN")
  return {
    orderId: bundle.order.id,
    reference: bundle.order.reference,
    snapshotAt: bundle.snapshotAt,
    vehicle: primary ? `${primary.vehicle.make} ${primary.vehicle.model}` : "Vehicle not linked",
    driver: driverId ? bundle.dir.driverName(driverId) : null,
    customer: bundle.customer.name,
    origin: pickup ? `${pickup.city}, ${pickup.country}` : "Unknown",
    destination: delivery ? `${delivery.city}, ${delivery.country}` : "Unknown",
    destinationCity: delivery?.city ?? "the delivery",
    messages: bundle.messages
      .slice()
      .sort((a, b) => a.authoredAt.localeCompare(b.authoredAt))
      .map((message) => {
        const actor = bundle.dir.resolve(message.details.author_id, message.authorType)
        return {
          id: message.id,
          at: message.authoredAt,
          author: actor.name,
          role: actor.role,
          channel: str(message.details.channel),
          visibility: str(message.details.visibility),
          body: message.body,
        }
      }),
    incident: {
      id: incident.id,
      kind: str(incident.details.kind),
      status: str(incident.details.status),
      openedAt: str(incident.details.opened_at),
      symptom: str(incident.details.reported_symptom),
      stopText: str(incident.details.reported_stop_text),
      locationVerified: bool(incident.details.location_verified),
      photoStatus: str(incident.details.warning_photo_status),
      recovery: str(incident.details.recovery_decision),
      owner: bundle.dir.title(incident.details.owner),
    },
    alerts: bundle.alerts.map((alert) => ({
      id: alert.id,
      signal: alert.signal,
      status: alert.status,
      severity: alert.severity,
      summary: alert.summary,
      triggeredAt: alert.triggeredAt,
      acknowledgedAt: str(alert.details.acknowledged_at),
      acknowledgement: str(alert.details.acknowledgement_reason),
      owner: bundle.dir.title(alert.details.owner),
    })),
    tracking: tracking ? {
      id: rows(bundle, "tracking_observations")
        .filter((row) => str(row.details.source) === "driver_app")
        .sort((a, b) => String(b.details.observed_at ?? "").localeCompare(String(a.details.observed_at ?? "")))[0]?.id ?? null,
      eta: tracking.eta,
      observedAt: tracking.observedAt,
      quality: tracking.quality,
      remainingKm: tracking.remainingKm,
      source: tracking.source,
    } : null,
    promise: windows.promise ? {
      id: rows(bundle, "time_windows").find((row) => str(row.details.purpose) === "CUSTOMER_DELIVERY_PROMISE" && bool(row.details.is_selected))?.id ?? null,
      start: windows.promise.start,
      end: windows.promise.end,
      zone: windows.promise.zone,
      source: windows.promise.source,
      sourceLabel: windows.promise.sourceLabel,
    } : null,
    proposal: proposal ? proposalSlice(bundle, proposal.id, proposal.details) : null,
    work: work ? {
      id: work.id,
      kind: str(work.details.kind),
      status: str(work.details.status),
      dueAt: str(work.details.due_at),
      summary: str(work.details.summary),
      nextAction: str(work.details.next_action),
      owner: bundle.dir.title(work.details.owner),
    } : null,
    documents: rows(bundle, "documents").map((row) => ({
      id: row.id,
      kind: str(row.details.kind),
      status: str(row.details.status),
      fileCount: num(row.details.file_count),
      required: bool(row.details.required),
    })),
  }
}

function proposalSlice(bundle: Bundle, id: string, details: Record<string, unknown>): Slice {
  const proposed = obj(details.proposed_payload)
  const review = obj(details.review)
  const finalPayload = obj(review?.final_payload)
  const execution = obj(details.execution)
  return {
    id,
    command: str(details.command),
    status: str(details.status),
    summary: str(details.summary),
    rationale: str(details.rationale),
    proposedMessage: str(proposed?.message),
    proposedRestart: bool(proposed?.authorize_restart),
    reviewDecision: str(review?.decision),
    reviewNote: str(review?.decision_note),
    reviewer: bundle.dir.title(review?.reviewer_id),
    reviewedAt: str(review?.reviewed_at),
    finalMessage: str(finalPayload?.message),
    finalRestart: bool(finalPayload?.authorize_restart),
    executionStatus: str(execution?.status),
  }
}

function fact(text: string, source: string, recordId: string, kind: CitedFact["kind"], at: string | null, state?: CitedFact["state"]): CitedFact {
  return { text, source, recordId, kind, at, state }
}

function messageById(slices: RoadSlices, id: string): Slice | null {
  return slices.messages.find((message) => message.id === id) ?? null
}

function quotedMessage(slices: RoadSlices, id: string): CitedFact | null {
  const message = messageById(slices, id)
  if (!message || typeof message.body !== "string" || typeof message.id !== "string") return null
  const channel = typeof message.channel === "string" ? label(message.channel) : "Message"
  const visibility = message.visibility === "INTERNAL" ? "internal" : null
  return fact(
    `${message.author}: “${message.body}”`,
    [channel, visibility].filter(Boolean).join(" · "),
    message.id,
    "message",
    typeof message.at === "string" ? message.at : null,
    "reported",
  )
}

export function driverDraft(vehicle: string): string {
  return `Please keep the ${vehicle} stopped, engine off. Send the service-area name or a location pin, and a photo of the dashboard warning. Do not restart the car and do not drive it. We do not yet know who will collect it.`
}

export function callScript(customer: string): string {
  return `${customer}: the car is stopped and the driver is safe. We do not have a verified place or a dashboard photo yet. Do you want your own roadside assistance, or collection? The delivery promise stays as you set it until you choose.`
}

function actionsFor(slices: RoadSlices, drafts?: { driver?: string; call?: string; promise?: string }): RoomAction[] {
  const promise = slices.promise
  const range = promise ? fmtRange(str(promise.start), str(promise.end), str(promise.zone)) : "the recorded promise"
  const tracking = slices.tracking
  const eta = tracking ? fmtDateTime(str(tracking.eta), str(promise?.zone)) : null
  const observed = tracking ? fmtDateTime(str(tracking.observedAt), str(promise?.zone)) : null
  const quality = typeof tracking?.quality === "string" ? label(tracking.quality) : "unverified"
  const promiseNote = drafts?.promise ?? (eta && observed
    ? `Leave ${range}${typeof promise?.sourceLabel === "string" ? `, ${promise.sourceLabel}` : ""}. The last driver-app ETA, ${eta}, comes from a ${quality} position at ${observed}, before the stop. It is not a current arrival, and no new time is written.`
    : `Leave ${range} as recorded. No new time is written.`)
  return [
    {
      id: "ask-driver",
      title: `Ask ${slices.driver ?? "the driver"} for the place and the photo`,
      whatChanges: "One message in the driver chat, in the exact text you approve. It does not clear the car to drive, book recovery, or change the promise.",
      draft: drafts?.driver ?? driverDraft(slices.vehicle),
      sendable: true,
    },
    {
      id: "hold-promise",
      title: "Leave the delivery promise as the customer set it",
      whatChanges: "Nothing is written. The promise stays on the order. Approving this records that you are not moving it.",
      draft: promiseNote,
      sendable: false,
    },
    {
      id: "owner-call",
      title: `The call to ${slices.customer} is yours`,
      whatChanges: "No email is sent. The customer has already said they will ask their service contact, and operations has already told them the journey is paused. Approving this records that you will make the call.",
      draft: drafts?.call ?? callScript(slices.customer),
      sendable: false,
    },
  ]
}

export function buildOnTheRoadCard(bundle: Bundle, source: OnTheRoadCard["source"] = "records"): OnTheRoadCard | null {
  const slices = roadSlices(bundle)
  if (!slices) return null
  return cardFromSlices(slices, source)
}

export function cardFromSlices(slices: RoadSlices, source: OnTheRoadCard["source"] = "records", drafts?: { driver?: string; call?: string; promise?: string; summary?: string }): OnTheRoadCard {
  const facts: CitedFact[] = []
  const push = (item: CitedFact | null) => { if (item) facts.push(item) }

  for (const message of slices.messages) {
    if (typeof message.id === "string") push(quotedMessage(slices, message.id))
  }

  const incident = slices.incident
  if (incident && typeof incident.id === "string") {
    push(fact(
      `${label(str(incident.kind))} is ${label(str(incident.status))}. Symptom: “${incident.symptom}”. Stop: “${incident.stopText}”. Location verified: ${incident.locationVerified === true ? "yes" : "no"}. Warning photo: ${label(str(incident.photoStatus))}. Recovery: ${label(str(incident.recovery))}.`,
      `Incident${incident.owner ? ` · ${incident.owner}` : ""}`,
      incident.id,
      "incident",
      str(incident.openedAt),
      incident.locationVerified === true ? "reported" : "missing",
    ))
  }

  const gap = slices.alerts.find((alert) => alert.signal === "TRACKING_GAP")
  const tracking = slices.tracking
  if (gap && typeof gap.id === "string") {
    const observed = tracking ? fmtDateTime(str(tracking.observedAt), str(slices.promise?.zone)) : null
    const eta = tracking ? fmtDateTime(str(tracking.eta), str(slices.promise?.zone)) : null
    const km = typeof tracking?.remainingKm === "number" ? `${tracking.remainingKm} km still to go` : "distance not recorded"
    push(fact(
      `${label(str(gap.signal))} is ${label(str(gap.status))}. “${gap.summary}” Last driver-app position is ${label(str(tracking?.quality))}${observed ? ` at ${observed}` : ""}, ${km}${eta ? `, with that observation's ETA ${eta}` : ""}. The observation is from before the stop, so it is not where the car is now.`,
      "Alert · tracking",
      gap.id,
      "alert",
      str(gap.triggeredAt),
      "stale",
    ))
  }

  const promise = slices.promise
  if (promise && typeof promise.id === "string") {
    const range = fmtRange(str(promise.start), str(promise.end), str(promise.zone))
    const rel = relativeTo(str(promise.end), slices.snapshotAt)
    push(fact(
      `Delivery promise ${range}, ${promise.sourceLabel}.${rel ? ` It ends ${rel.text} at the snapshot.` : ""} It has not been replaced.`,
      "Time window",
      promise.id,
      "window",
      str(promise.end),
      "recorded",
    ))
  }

  const photo = slices.documents.find((document) => document.kind === "CONDITION_PHOTO")
  if (photo && typeof photo.id === "string") {
    push(fact(
      `${label(str(photo.kind))} is ${label(str(photo.status))}, ${photo.fileCount ?? 0} file${photo.fileCount === 1 ? "" : "s"}.`,
      "Document",
      photo.id,
      "document",
      null,
      (photo.fileCount ?? 0) === 0 ? "missing" : "recorded",
    ))
  }

  const alreadyDone: CitedFact[] = []
  const proposal = slices.proposal
  if (proposal && typeof proposal.id === "string" && typeof proposal.proposedMessage === "string" && typeof proposal.reviewNote === "string") {
    alreadyDone.push(fact(
      `Journey monitor proposed “${proposal.proposedMessage}” with authorize restart ${proposal.proposedRestart === true ? "on" : "off"}. ${proposal.reviewer ?? "A person"} ${label(str(proposal.reviewDecision)).toLowerCase()} it: “${proposal.reviewNote}”. The text that was sent asks for a place and says nobody has cleared onward driving. Restart stayed off.`,
      `Proposal · ${label(str(proposal.status))}`,
      proposal.id,
      "proposal",
      str(proposal.reviewedAt),
      "recorded",
    ))
  }
  const work = slices.work
  if (work && typeof work.id === "string") {
    const due = fmtDateTime(str(work.dueAt), str(promise?.zone))
    alreadyDone.push(fact(
      `${label(str(work.kind))} is ${label(str(work.status))}${due ? `, due ${due}` : ""}. “${work.nextAction}”`,
      `Work item${work.owner ? ` · ${work.owner}` : ""}`,
      work.id,
      "work",
      str(work.dueAt),
      "recorded",
    ))
  }

  const missing = [
    incident?.locationVerified === false ? "The stop has no verified place." : null,
    photo && photo.fileCount === 0 ? "The dashboard photo has not arrived." : null,
    incident?.recovery === "PENDING_CUSTOMER" ? `${slices.customer} has not chosen roadside assistance or collection.` : null,
    "The delivery promise has not been changed, and this card does not change it.",
  ].filter((item): item is string => !!item)

  const safety = slices.alerts.find((alert) => alert.signal === "SAFETY_STOP")
  const headline = `${slices.vehicle} is stopped. ${slices.driver ?? "The driver"} is safe. Delivery to ${slices.destinationCity} is not decided.`
  const summary = drafts?.summary ?? `${slices.reference}, ${slices.origin} to ${slices.destination}. ${safety ? `${label(String(safety.signal))} is ${label(String(safety.status))}, not resolved. ` : ""}${slices.customer} has been asked and has not chosen. The photo and the exact place are still missing. Do not clear the car to drive.`

  return {
    kind: "on_the_road",
    kicker: "Vehicle warning",
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

export function applyAgentDrafts(base: OnTheRoadCard, slices: RoadSlices, input: { summary?: string; driverDraft?: string; callScript?: string; promiseNote?: string }): { card: OnTheRoadCard; refusedDraft: string | null } {
  const summary = input.summary && !summaryProblem(input.summary) ? input.summary.trim() : undefined
  const driverProblem = input.driverDraft ? driverDraftProblem(input.driverDraft) : "The agent did not write a driver message."
  const driver = driverProblem ? undefined : input.driverDraft?.trim()
  const card = cardFromSlices(slices, driver || summary ? "agent" : "records", {
    summary,
    driver,
    call: input.callScript?.trim() || undefined,
    promise: input.promiseNote?.trim() || undefined,
  })
  // Facts, the missing list and the record of what already happened stay from the snapshot.
  card.facts = base.facts
  card.missing = base.missing
  card.alreadyDone = base.alreadyDone
  card.headline = base.headline
  if (!summary) card.summary = base.summary
  return { card, refusedDraft: driverProblem ? input.driverDraft?.trim() || null : null }
}

export function actionAllowed(id: string): id is ActionId {
  return id === "ask-driver" || id === "hold-promise" || id === "owner-call"
}
