// What the driver can see. Driver chat only. Internal notes and the customer
// email stay on the desk. An approved driver message is shown apart from the
// thread, because approving it does not put it on his phone.

import { decisionsFor } from "@/lib/agent/session"
import { str } from "@/lib/present/bundle"
import { loadBoardBundles, loadOrder } from "@/lib/present/load"
import { isOpenVehicleWarning } from "./on-the-road"

export type DriverLine = {
  id: string
  at: string
  mine: boolean
  who: string
  body: string
}

export type DriverPhone = {
  orderId: string
  snapshotAt: string | null
  zone: string | null
  reference: string
  vehicle: string
  driver: string
  lines: DriverLine[]
  waiting: string
  pending: { text: string; at: string } | null
}

export async function loadDriverPhone(): Promise<DriverPhone | null> {
  const { snapshotAt, bundles } = await loadBoardBundles()
  const brief = bundles.find(isOpenVehicleWarning)
  if (!brief) return null
  const loaded = await loadOrder(brief.order.id)
  if (!loaded) return null
  const bundle = loaded.bundle
  const primary = bundle.items.find((item) => item.role === "PRIMARY") ?? bundle.items[0] ?? null
  const assignment = bundle.related.work_assignments?.find((row) => str(row.details.status) === "IN_PROGRESS")
    ?? bundle.related.work_assignments?.[0]
  const driverId = assignment ? str(assignment.details.driver_id) : null
  const driver = (driverId ? bundle.dir.driverName(driverId) : null) ?? "Driver"
  const place = bundle.places.get(bundle.order.pickupAddressId)
  const lines = bundle.messages
    .filter((message) => str(message.details.channel) === "driver_chat" && str(message.details.visibility) !== "INTERNAL")
    .slice()
    .sort((a, b) => a.authoredAt.localeCompare(b.authoredAt))
    .map((message) => {
      const mine = message.authorType === "driver"
      return { id: message.id, at: message.authoredAt, mine, who: mine ? driver : "Desk", body: message.body }
    })
  const decision = (await decisionsFor(bundle.order.id)).find((item) => item.actionId === "ask-driver" && item.choice !== "rejected" && item.text)
  const last = lines[lines.length - 1]
  return {
    orderId: bundle.order.id,
    snapshotAt,
    zone: str(place?.details.timezone),
    reference: bundle.order.reference,
    vehicle: primary ? `${primary.vehicle.make} ${primary.vehicle.model}` : "Vehicle",
    driver,
    lines,
    waiting: last?.mine ? last.body : "Waiting.",
    pending: decision?.text ? { text: decision.text, at: decision.at } : null,
  }
}
