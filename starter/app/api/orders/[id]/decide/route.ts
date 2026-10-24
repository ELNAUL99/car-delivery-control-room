import { NextResponse } from "next/server"
import { recordDecision } from "@/lib/agent/session"
import { loadOrder } from "@/lib/present/load"
import { effectFor } from "@/lib/room/effect"
import { kindFor } from "@/lib/room/kinds"
import type { SessionDecision } from "@/lib/room/types"

export const runtime = "nodejs"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = await request.json().catch(() => null) as { actionId?: unknown; choice?: unknown; text?: unknown } | null
  const actionId = typeof body?.actionId === "string" ? body.actionId : ""
  const choice = body?.choice
  const text = typeof body?.text === "string" ? body.text.trim() : null

  const loaded = await loadOrder(id)
  if (!loaded) return NextResponse.json({ error: "Order not found" }, { status: 404 })
  const kind = kindFor(loaded.bundle)
  if (!kind) return NextResponse.json({ error: "No deep case for this order" }, { status: 400 })
  if (!kind.actionIds.includes(actionId)) return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  if (choice !== "approved" && choice !== "rejected" && choice !== "edited") {
    return NextResponse.json({ error: "Unknown decision" }, { status: 400 })
  }
  if (choice !== "rejected") {
    const problem = kind.guardAction(actionId, text)
    if (problem) return NextResponse.json({ error: problem }, { status: 422 })
  }

  const effect = effectFor(actionId, choice)
  const decision: SessionDecision = { orderId: id, actionId, choice, text, at: new Date().toISOString(), effect }
  await recordDecision(decision)
  return NextResponse.json({ decision, effect })
}
