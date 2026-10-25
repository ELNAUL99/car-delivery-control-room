import { NextResponse } from "next/server"
import { runPickupCall } from "@/lib/agent/phone"
import { rows, str } from "@/lib/present/bundle"
import { loadOrder } from "@/lib/present/load"
import { kindFor } from "@/lib/room/kinds"
import { isOpenPickupCase } from "@/lib/room/pickup"

export const runtime = "nodejs"

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const loaded = await loadOrder(id)
  if (!loaded) return NextResponse.json({ error: "Order not found" }, { status: 404 })
  const kind = kindFor(loaded.bundle)
  if (!kind || kind.id !== "pickup_readiness") {
    return NextResponse.json({ error: "No pickup place to call for this order" }, { status: 400 })
  }
  const bundle = loaded.bundle
  const primary = bundle.items.find((item) => item.role === "PRIMARY") ?? bundle.items[0] ?? null
  const place = bundle.places.get(bundle.order.pickupAddressId)
  const endpoint = rows(bundle, "order_endpoint_details").find((row) => str(row.details.boundary) === "PICKUP")

  // --- LIVE TELEPHONY SEAM (inert; see lib/agent/phone-live.ts) --------------
  // When Twilio credentials + a from-number are present AND the branch has a
  // dialable E.164 number, place a real call and return { status:"dialing" }.
  // With no credentials this whole block is skipped and we run the mock below,
  // so the repo keeps working unchanged. Uncomment to activate the real call.
  //
  // import { liveTelephonyEnabled, pickProvider, resolveBranchNumber } from "@/lib/agent/telephony"
  // const branch = place ? resolveBranchNumber(place.details) : null
  // if (liveTelephonyEnabled() && branch) {
  //   const started = await pickProvider().startPickupCall({
  //     site: place ? (str(place.details.name) ?? place.name ?? `${place.city}`) : "the pickup place",
  //     reference: bundle.order.reference,
  //     vehicle: primary ? `${primary.vehicle.make} ${primary.vehicle.model}` : "the vehicle",
  //     vin: primary?.vehicle.vin ?? null,
  //     identityUnresolved: isOpenPickupCase(bundle),
  //     accessNeedsVerify: endpoint ? str(endpoint.details.access_status) === "NEEDS_VERIFICATION" : false,
  //   }, branch)
  //   return NextResponse.json({ status: "dialing", callId: started.callId })
  // }
  // ---------------------------------------------------------------------------

  const call = runPickupCall({
    site: place ? (str(place.details.name) ?? place.name ?? `${place.city}`) : "the pickup place",
    reference: bundle.order.reference,
    vehicle: primary ? `${primary.vehicle.make} ${primary.vehicle.model}` : "the vehicle",
    vin: primary?.vehicle.vin ?? null,
    identityUnresolved: isOpenPickupCase(bundle),
    accessNeedsVerify: endpoint ? str(endpoint.details.access_status) === "NEEDS_VERIFICATION" : false,
  })
  return NextResponse.json(call)
}
