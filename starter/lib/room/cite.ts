// Small helpers the deep areas share to cite records on a card. Every fact
// carries its source and record id, so a reader can open the order and check it.

import { type Bundle, str } from "@/lib/present/bundle"
import { label } from "@/lib/present/labels"
import type { CitedFact } from "./types"

export function fact(text: string, source: string, recordId: string, kind: CitedFact["kind"], at: string | null): CitedFact {
  return { text, source, recordId, kind, at }
}

/** Quote the order's messages oldest-first, each as a cited fact. */
export function messageFacts(bundle: Bundle, opts?: { channel?: string; limit?: number }): CitedFact[] {
  const out: CitedFact[] = []
  const sorted = bundle.messages.slice().sort((a, b) => a.authoredAt.localeCompare(b.authoredAt))
  for (const message of sorted) {
    if (opts?.channel && str(message.details.channel) !== opts.channel) continue
    const actor = bundle.dir.resolve(message.details.author_id, message.authorType)
    const channel = str(message.details.channel)
    const visibility = str(message.details.visibility) === "INTERNAL" ? "internal" : null
    out.push(fact(
      `${actor.name}: “${message.body}”`,
      [channel ? label(channel) : "Message", visibility].filter(Boolean).join(" · "),
      message.id,
      "message",
      message.authoredAt,
    ))
  }
  return opts?.limit ? out.slice(-opts.limit) : out
}

export function primaryVehicle(bundle: Bundle): string {
  const primary = bundle.items.find((item) => item.role === "PRIMARY") ?? bundle.items[0] ?? null
  return primary ? `${primary.vehicle.make} ${primary.vehicle.model}` : "the vehicle"
}

export function placeLabel(bundle: Bundle, addressId: string): string {
  const place = bundle.places.get(addressId)
  return place ? `${place.city}, ${place.country}` : "Unknown"
}
