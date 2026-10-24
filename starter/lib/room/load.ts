import { listDecisions, loadInvestigation } from "@/lib/agent/session"
import { buildBoardCard } from "@/lib/present/board"
import { loadBoardBundles, loadOrder } from "@/lib/present/load"
import { kindFor } from "./kinds"
import { assembleRoom } from "./queue"
import { loadSupportCases } from "./support"
import type { CaseKindId, Investigation, RoomCard, RoomPayload } from "./types"

export async function loadRoom(): Promise<RoomPayload> {
  const { snapshotAt, bundles } = await loadBoardBundles()
  const cards = bundles.map(buildBoardCard)

  // Cheap first pass over the board bundles: which orders does a deep area own?
  const candidates = bundles
    .map((bundle) => ({ id: bundle.order.id, kind: kindFor(bundle) }))
    .filter((entry): entry is { id: string; kind: NonNullable<ReturnType<typeof kindFor>> } => !!entry.kind)

  // Full-load only those few orders and build the real, cited card for each.
  const deepCards = new Map<string, { kind: CaseKindId; card: RoomCard }>()
  const investigations: Record<string, Investigation> = {}
  let stopped = 0
  await Promise.all(candidates.map(async ({ id, kind }) => {
    const loaded = await loadOrder(id)
    if (!loaded) return
    const card = kind.buildCard(loaded.bundle)
    if (!card) return
    if (kind.halt(loaded.bundle)) stopped += 1
    const saved = await loadInvestigation(id)
    // A saved agent look overlays the records card (it kept the cited facts).
    deepCards.set(id, { kind: kind.id, card: saved?.card ? { ...saved.card, facts: card.facts, alreadyDone: card.alreadyDone, missing: card.missing } : card })
    if (saved) investigations[id] = saved
  }))

  // Driver Support runs on the inbox, not per order.
  const support = await loadSupportCases()
  await Promise.all(support.map(async (item) => {
    const saved = await loadInvestigation(item.threadId)
    if (saved) {
      investigations[item.threadId] = saved
      item.card = { ...saved.card, facts: item.card.facts, alreadyDone: item.card.alreadyDone, missing: item.card.missing }
    }
  }))

  const needing = cards.filter((card) => card.attention.length > 0).length
  const openAlerts = bundles.filter((bundle) => bundle.alerts.some((alert) => alert.status === "OPEN")).length
  const bahnWorking = bundles.filter((bundle) =>
    (bundle.related.work_items ?? []).some((row) => row.details.owner && row.details.due_at),
  ).length
  const stats = {
    total: bundles.length,
    needing,
    quiet: bundles.length - needing,
    openAlerts,
    ready: deepCards.size,
    stopped,
    bahnWorking,
  }

  const base = assembleRoom(snapshotAt, cards, deepCards, await listDecisions())
  return { ...base, support, investigations, stats }
}
