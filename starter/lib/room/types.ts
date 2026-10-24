// The control-room queue. Plain data so a server page can hand it to the client.
// Facts cite dataset records. A session decision is not a write to the snapshot.

import type { Bundle } from "@/lib/present/bundle"
import type { KeyDate, Tone } from "@/lib/present/types"

// The five deep areas. Each is a CaseKind: a detector, a records-cited card, and a
// tool-using agent that does the cheap work first and brings one decision.
export type CaseKindId =
  | "on_the_road" | "driver_travel" | "pickup_readiness" | "driver_support" | "promise_guardian"

// Action ids vary by area. The decide route validates against the matching kind's
// own action list and guards, so this stays an open string.
export type ActionId = string
export const ACTION_IDS = ["ask-driver", "hold-promise", "owner-call"] as const

export type CiteKind = "message" | "incident" | "alert" | "work" | "proposal" | "document" | "window" | "tracking" | "offer" | "reservation" | "inbox"

export type CitedFact = {
  text: string
  source: string
  recordId: string
  kind: CiteKind
  at: string | null
}

export type RoomAction = {
  id: ActionId
  title: string
  whatChanges: string
  draft: string | null
  /** A driver message can be approved as an exact text. A customer is never sent one from here. */
  sendable: boolean
}

export type RoomCard = {
  /** Which deep area this card belongs to. */
  kind: CaseKindId
  /** Short chip shown on the card, e.g. "Vehicle warning", "Ferry at risk". */
  kicker: string
  orderId: string
  headline: string
  summary: string
  missing: string[]
  facts: CitedFact[]
  alreadyDone: CitedFact[]
  actions: RoomAction[]
  /** "records" is the reading of the snapshot. "agent" means a model rewrote the summary or a draft, and the facts stayed cited. */
  source: "records" | "agent"
}

/** Back-compat alias — the On-the-Road card is just a RoomCard. */
export type OnTheRoadCard = RoomCard

export type RoomCase = {
  id: string
  reference: string
  vehicle: string
  customer: string
  origin: string
  destination: string
  tone: Tone
  decisive: KeyDate | null
  line: string
  detail: string | null
  more: number
  /** The deep area for this order, if any. */
  kind: CaseKindId | null
  /** The full decision card, present when a deep area owns this order. */
  card: RoomCard | null
}

export type SessionDecision = {
  orderId: string
  actionId: ActionId
  choice: "approved" | "rejected" | "edited"
  text: string | null
  at: string
}

// Driver Support runs on the support inbox, not per order, so it carries its own
// thread case shape rather than a RoomCase.
export type SupportCase = {
  threadId: string
  category: string
  categoryLabel: string
  channel: string
  linkState: string
  linkStateLabel: string
  waitingOn: string | null
  basis: string | null
  candidates: { id: string; reference: string }[]
  linked: { id: string; reference: string }[]
  tone: "danger" | "warn" | "accent" | "neutral"
  card: RoomCard
}

export type RoomPayload = {
  snapshotAt: string | null
  heroes: RoomCase[]
  rest: RoomCase[]
  support: SupportCase[]
  decisions: SessionDecision[]
  /** The latest saved agent look per order id or support thread id. */
  investigations: Record<string, Investigation>
}

export type AgentTrace = { tool: string; summary: string }

export type Investigation = {
  ok: boolean
  error: string | null
  card: RoomCard
  trace: AgentTrace[]
  refusedDraft: string | null
  lookedAt?: string
}

// --- Case-kind registry contract -----------------------------------------
// Each deep area implements this. The queue, the agent routes and the decide
// route dispatch through it, so adding an area is adding one CaseKind.

export type AgentToolDef = {
  type: "function"
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type CaseKind = {
  id: CaseKindId
  /** Chip shown on the card. */
  kicker: string
  /** Human label for the area. */
  label: string
  /** Lower runs first when several areas match one order. */
  priority: number
  /** Does this order have an open case of this kind? */
  detect(bundle: Bundle): boolean
  /** The card read straight off the snapshot (no model). */
  buildCard(bundle: Bundle): RoomCard | null
  /** The agent look: cheap reads, then one decision, under guardrails. */
  investigate(bundle: Bundle): Promise<Investigation>
  /** Action ids this card can carry. */
  actionIds: readonly string[]
  /** A problem string if this action's approved text is not allowed, else null. */
  guardAction(actionId: string, text: string | null): string | null
}
