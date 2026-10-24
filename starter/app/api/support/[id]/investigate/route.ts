import { NextResponse } from "next/server"
import { loadInvestigation, saveInvestigation } from "@/lib/agent/session"
import { withTurn } from "@/lib/agent/talk"
import { investigateSupport, loadSupportThread } from "@/lib/room/support"

export const runtime = "nodejs"

async function noteOf(request: Request): Promise<string> {
  const body = await request.json().catch(() => null) as { note?: unknown } | null
  return typeof body?.note === "string" ? body.note.trim().slice(0, 500) : ""
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const note = await noteOf(request)
  const support = await loadSupportThread(id)
  if (!support) return NextResponse.json({ error: "Support thread not found" }, { status: 404 })
  const previous = await loadInvestigation(id)
  try {
    const looked = await investigateSupport(support, note || undefined, previous?.turns)
    const result = withTurn(looked, previous, note)
    await saveInvestigation(id, result)
    return NextResponse.json(result)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The agent could not look"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
