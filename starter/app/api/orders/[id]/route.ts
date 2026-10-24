import { NextResponse } from "next/server"
import { decisionsFor, loadInvestigation } from "@/lib/agent/session"
import { loadOrder } from "@/lib/present/load"
import { buildRecordView } from "@/lib/present/record"
import { roomProposalViews } from "@/lib/room/activity-view"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const loaded = await loadOrder(id)
  if (!loaded) return NextResponse.json({ error: "Order not found" }, { status: 404 })
  const { order, customer, pickup, delivery, pickupSite, deliverySite, items, alerts, threads, messages, events, related, bundleOrderRefs, drivers, bundle } = loaded
  // The raw records keep their shape for anyone reading the API. `view` is the
  // same information read out with labels, names and grouping for the interface.
  const view = buildRecordView(bundle)
  const roomWork = roomProposalViews(await decisionsFor(id), await loadInvestigation(id))
  view.proposals = [...roomWork, ...view.proposals]
  const decisionsSection = view.sections.find((section) => section.id === "decisions")
  if (decisionsSection) decisionsSection.count = view.proposals.length
  return NextResponse.json({
    order, customer, pickup, delivery, pickupSite, deliverySite, items, drivers, alerts, conversations: threads, messages, events,
    related, bundleOrderRefs, view,
  })
}
