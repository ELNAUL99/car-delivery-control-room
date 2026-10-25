// Pickup readiness, by phone. When the driver is at the pickup place, the agent
// calls the branch to confirm the exact car, the keys and a signed release before
// any handover. The phone line, the menu and the branch answers are mocked (the
// brief allows this); the questions follow the real readiness records. Calling to
// ASK needs no approval, and the pickup place is fine to contact.

import type { CallLine, PickupCall, ReadyItem } from "@/lib/room/types"

export type PickupCtx = {
  site: string
  reference: string
  vehicle: string
  vin: string | null
  /** The driver attempted pickup and the exact car is not confirmed (empty pickup). */
  identityUnresolved: boolean
  /** The pickup endpoint access/bay is not verified. */
  accessNeedsVerify: boolean
}

export function runPickupCall(ctx: PickupCtx): PickupCall {
  const vin = ctx.vin ?? "the recorded VIN"
  const t: CallLine[] = []
  t.push({ who: "system", text: `Driver is at ${ctx.site}. Dialing the branch desk to confirm readiness for ${ctx.reference}…` })
  t.push({ who: "ivr", text: `"Welcome to ${ctx.site}. For vehicle collections, press 1. For reception, press 2."` })
  t.push({ who: "agent", text: "Presses 1 — vehicle collections." })
  // First attempt: no answer, then a retry (shows the "try again later" behaviour).
  t.push({ who: "system", text: "Ringing… no answer after 30 seconds." })
  t.push({ who: "agent", text: "No answer. Retrying the collection desk." })
  t.push({ who: "system", text: "Redialing…" })
  t.push({ who: "desk", text: "\"Collection desk, hello.\"" })
  t.push({ who: "agent", text: `"This is Bahn operations about collection ${ctx.reference} — a ${ctx.vehicle}. Can you confirm the exact VIN ${vin} is in your release queue today?"` })

  const checklist: ReadyItem[] = []
  if (ctx.identityUnresolved) {
    t.push({ who: "desk", text: "\"I can see a similar stock reference, but not that exact VIN.\"" })
    t.push({ who: "agent", text: "\"A similar reference isn't a match. Are the keys and a signed, vehicle-specific release ready for that exact VIN?\"" })
    t.push({ who: "desk", text: "\"Not for that VIN, no.\"" })
    t.push({ who: "agent", text: "\"Understood. We won't collect on a similar reference. Please locate the exact VIN — our driver is on site and holding.\"" })
    t.push({ who: "system", text: "Call ended. Collection held pending identity." })
    checklist.push({ label: "Exact car on site (VIN)", ok: false, note: "Branch sees a similar stock reference, not this VIN" })
    checklist.push({ label: "Keys available", ok: false, note: "Not for the exact VIN" })
    checklist.push({ label: "Signed vehicle-specific release", ok: false, note: "Not ready for this VIN" })
  } else {
    t.push({ who: "desk", text: "\"Yes, that VIN is in the queue.\"" })
    t.push({ who: "agent", text: "\"Great. Keys and a signed vehicle-specific release ready for it?\"" })
    t.push({ who: "desk", text: "\"Both ready at the desk.\"" })
    t.push({ who: "system", text: "Call ended. Car confirmed ready." })
    checklist.push({ label: "Exact car on site (VIN)", ok: true, note: "Confirmed in the release queue" })
    checklist.push({ label: "Keys available", ok: true, note: "At the collection desk" })
    checklist.push({ label: "Signed vehicle-specific release", ok: true, note: "Ready at the desk" })
  }
  checklist.push({ label: "Collection bay assigned", ok: !ctx.accessNeedsVerify, note: ctx.accessNeedsVerify ? "Desk to assign on check-in" : "Assigned" })
  checklist.push({ label: "Staff to authorise handover", ok: true, note: "Collection desk reached" })

  const ready = checklist.every((item) => item.ok)
  const outcome = ctx.identityUnresolved
    ? `Not ready — the exact car isn't confirmed. Collection on hold; driver waiting. Asked the branch to locate VIN ${vin}.`
    : ready
      ? "Ready — car, keys and release confirmed. The driver can collect."
      : "Mostly ready — only the bay is pending; the desk assigns it on check-in."

  return { site: ctx.site, reference: ctx.reference, attempts: 2, reached: true, ready, transcript: t, checklist, outcome }
}
