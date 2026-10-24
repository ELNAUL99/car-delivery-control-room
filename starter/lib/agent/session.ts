import { and, desc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { roomActivity } from "@/lib/schema"
import type { Investigation, SessionDecision } from "@/lib/room/types"

function decisionId(orderId: string, actionId: string): string {
  return `decision:${orderId}:${actionId}`
}

function investigationId(orderId: string): string {
  return `investigation:${orderId}`
}

export async function listDecisions(): Promise<SessionDecision[]> {
  const rows = await db.select().from(roomActivity).where(eq(roomActivity.kind, "decision")).orderBy(desc(roomActivity.recordedAt))
  return rows.map((row) => row.details as unknown as SessionDecision)
}

export async function decisionsFor(orderId: string): Promise<SessionDecision[]> {
  const rows = await db.select().from(roomActivity).where(and(
    eq(roomActivity.kind, "decision"),
    eq(roomActivity.orderId, orderId),
  )).orderBy(desc(roomActivity.recordedAt))
  return rows.map((row) => row.details as unknown as SessionDecision)
}

export async function recordDecision(decision: SessionDecision): Promise<SessionDecision> {
  const details = decision as unknown as Record<string, unknown>
  await db.insert(roomActivity).values({
    id: decisionId(decision.orderId, decision.actionId),
    orderId: decision.orderId,
    kind: "decision",
    recordedAt: new Date(decision.at),
    details,
  }).onConflictDoUpdate({
    target: roomActivity.id,
    set: { recordedAt: new Date(decision.at), details },
  })
  return decision
}

export async function loadInvestigation(orderId: string): Promise<Investigation | null> {
  const [row] = await db.select().from(roomActivity).where(eq(roomActivity.id, investigationId(orderId))).limit(1)
  return row ? row.details as unknown as Investigation : null
}

export async function saveInvestigation(orderId: string, result: Investigation): Promise<void> {
  const at = new Date()
  const details = { ...result, lookedAt: result.lookedAt ?? at.toISOString() } as unknown as Record<string, unknown>
  await db.insert(roomActivity).values({
    id: investigationId(orderId),
    orderId,
    kind: "investigation",
    recordedAt: at,
    details,
  }).onConflictDoUpdate({
    target: roomActivity.id,
    set: { recordedAt: at, details },
  })
}
