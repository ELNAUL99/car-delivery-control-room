// The legwork: search alternative vehicle crossings when one is missed or at risk,
// and reason about which the driver can actually make. Timetables and prices are
// mocked (the brief allows made-up prices and timetables); feasibility is reasoned
// against the driver's road time to the terminal and each sailing's check-in cutoff.

import type { CrossingOption, TravelResearch } from "@/lib/room/types"

export type SearchInput = {
  snapshotAt: string | null
  from: string
  to: string
  operator: string
  roadHoursToTerminal: number | null
  /** The crossings already on the order (the missed one, the quote). */
  recorded: { departure: string | null; arrival: string | null; priceCents: number | null; status: string | null; checkInCutoff: string | null }[]
}

function slotOf(status: string | null): CrossingOption["slot"] {
  if (status === "SOLD_OUT") return "sold_out"
  if (status === "AVAILABLE_QUOTE") return "quoted"
  return "available"
}

function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const t = (new Date(a).getTime() - new Date(b).getTime()) / 3_600_000
  return Number.isFinite(t) ? t : null
}

function isFeasible(cutoff: string | null, snapshotAt: string | null, roadHours: number | null, slot: CrossingOption["slot"]): { ok: boolean; note: string } {
  if (slot === "sold_out") return { ok: false, note: "No vehicle slot" }
  const lead = hoursBetween(cutoff, snapshotAt)
  if (lead == null || roadHours == null) return { ok: true, note: "Slot available" }
  if (lead < roadHours) return { ok: false, note: `Check-in in ${Math.round(lead)}h, but ${roadHours}h of road to the terminal` }
  const spare = Math.round(lead - roadHours)
  return { ok: true, note: `${roadHours}h road, ~${spare}h spare before check-in` }
}

function addHours(iso: string, h: number): string {
  return new Date(new Date(iso).getTime() + h * 3_600_000).toISOString()
}

export function searchCrossings(input: SearchInput): CrossingOption[] {
  const out: CrossingOption[] = []
  const push = (id: string, departure: string | null, arrival: string | null, priceCents: number | null, slot: CrossingOption["slot"], cutoff: string | null) => {
    if (!departure) return
    const feas = isFeasible(cutoff, input.snapshotAt, input.roadHoursToTerminal, slot)
    out.push({
      id, operator: input.operator, from: input.from, to: input.to,
      departure, arrival: arrival ?? addHours(departure, 11), priceEur: priceCents != null ? Math.round(priceCents / 100) : null,
      slot, checkInCutoff: cutoff ?? addHours(departure, -2), roadHoursToTerminal: input.roadHoursToTerminal,
      feasible: feas.ok, note: feas.note,
    })
  }

  // The crossings already on the order.
  input.recorded.forEach((r, i) => push(`rec-${i}`, r.departure, r.arrival, r.priceCents, slotOf(r.status), r.checkInCutoff))

  // Two more the search turns up, after the latest recorded sailing.
  const latest = input.recorded.map((r) => r.departure).filter((d): d is string => !!d).sort().pop()
  const base = latest ?? input.snapshotAt ?? new Date().toISOString()
  push("alt-1", addHours(base, 8), null, 34500, "available", addHours(base, 6))
  push("alt-2", addHours(base, 20), null, 41000, "sold_out", addHours(base, 18))

  return out.sort((a, b) => a.departure.localeCompare(b.departure))
}

export function recommend(crossings: CrossingOption[]): TravelResearch {
  const bookable = crossings.filter((c) => c.feasible && c.slot !== "sold_out").sort((a, b) => a.departure.localeCompare(b.departure))
  const chosen = bookable[0] ?? null
  const soldOut = crossings.filter((c) => c.slot === "sold_out").length
  let reasoning: string
  if (!chosen) {
    reasoning = `None of the ${crossings.length} crossings has a vehicle slot the driver can still make. Keep searching and hold the promise.`
  } else {
    const cheaper = bookable.find((c) => c.id !== chosen.id && (c.priceEur ?? 0) < (chosen.priceEur ?? 0))
    const tradeOff = cheaper
      ? ` The ${new Date(cheaper.departure).toUTCString().slice(0, 16)} is ${(chosen.priceEur ?? 0) - (cheaper.priceEur ?? 0)} EUR cheaper but departs later, pushing the delivery further.`
      : ""
    reasoning = `${soldOut} of ${crossings.length} sailings have no vehicle slot. Of the ${bookable.length} with space, the earliest the driver reaches in time is the ${chosen.operator} crossing departing ${new Date(chosen.departure).toUTCString().slice(0, 16)}${chosen.priceEur != null ? `, ${chosen.priceEur} EUR` : ""} (${chosen.note}).${tradeOff} Propose booking it and a revised delivery for the customer to approve. Nothing is booked until you approve.`
  }
  return { crossings, chosenId: chosen?.id ?? null, reasoning }
}
