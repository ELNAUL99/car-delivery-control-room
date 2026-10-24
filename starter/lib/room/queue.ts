import type { BoardCard, Tone } from "@/lib/present/types"
import type { CaseKindId, RoomCard, RoomCase, SessionDecision } from "./types"

const TONE_RANK: Record<Tone, number> = { danger: 0, warn: 1, accent: 2, neutral: 3, ok: 4 }

function byUrgency(a: RoomCase, b: RoomCase): number {
  const tone = TONE_RANK[a.tone] - TONE_RANK[b.tone]
  if (tone) return tone
  return String(a.decisive?.end ?? a.decisive?.start ?? "9999").localeCompare(String(b.decisive?.end ?? b.decisive?.start ?? "9999"))
}

export function caseFromCard(card: BoardCard, kind: CaseKindId | null, deep: RoomCard | null): RoomCase | null {
  if (card.attention.length === 0 && !deep) return null
  const top = card.attention[0]
  return {
    id: card.id,
    reference: card.reference,
    vehicle: card.vehicle,
    customer: card.customer,
    origin: card.origin,
    destination: card.destination,
    // A deep case always warrants a person; otherwise take the board's strongest tone.
    tone: deep ? (card.attentionTone === "ok" ? "accent" : card.attentionTone) : card.attentionTone,
    decisive: card.decisive,
    line: deep?.headline ?? top?.short ?? "Needs a person",
    detail: top?.detail ?? null,
    more: Math.max(0, card.attention.length - 1),
    kind,
    card: deep,
  }
}

export function assembleRoom(
  snapshotAt: string | null,
  cards: BoardCard[],
  deepCards: Map<string, { kind: CaseKindId; card: RoomCard }>,
  decisions: SessionDecision[],
): Omit<import("./types").RoomPayload, "investigations" | "support" | "stats"> {
  const cases = cards
    .map((card) => {
      const deep = deepCards.get(card.id)
      return caseFromCard(card, deep?.kind ?? null, deep?.card ?? null)
    })
    .filter((item): item is RoomCase => !!item)
    .sort(byUrgency)
  return {
    snapshotAt,
    heroes: cases.filter((item) => item.card),
    rest: cases.filter((item) => !item.card),
    decisions,
  }
}
