import { NextResponse } from "next/server"
import { recordDecision } from "@/lib/agent/session"
import { effectFor } from "@/lib/room/effect"
import { loadSupportThread, supportReplyProblem } from "@/lib/room/support"
import type { SessionDecision } from "@/lib/room/types"

export const runtime = "nodejs"

const ACTIONS = ["answer", "resolve-link", "escalate"]

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = await request.json().catch(() => null) as { actionId?: unknown; choice?: unknown; text?: unknown } | null
  const actionId = typeof body?.actionId === "string" ? body.actionId : ""
  const choice = body?.choice
  const text = typeof body?.text === "string" ? body.text.trim() : null

  const support = await loadSupportThread(id)
  if (!support) return NextResponse.json({ error: "Support thread not found" }, { status: 404 })
  if (!ACTIONS.includes(actionId)) return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  if (choice !== "approved" && choice !== "rejected" && choice !== "edited") {
    return NextResponse.json({ error: "Unknown decision" }, { status: 400 })
  }
  if (actionId === "answer" && choice !== "rejected") {
    const problem = supportReplyProblem(text ?? "", support.linkState)
    if (problem) return NextResponse.json({ error: problem }, { status: 422 })
  }

  const effect = effectFor(actionId, choice)
  const decision: SessionDecision = { orderId: id, actionId, choice, text, at: new Date().toISOString(), effect }
  await recordDecision(decision)
  return NextResponse.json({ decision, effect })
}
