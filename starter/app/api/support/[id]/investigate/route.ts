import { NextResponse } from "next/server"
import { saveInvestigation } from "@/lib/agent/session"
import { investigateSupport, loadSupportThread } from "@/lib/room/support"

export const runtime = "nodejs"

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const support = await loadSupportThread(id)
  if (!support) return NextResponse.json({ error: "Support thread not found" }, { status: 404 })
  try {
    const result = await investigateSupport(support)
    await saveInvestigation(id, result)
    return NextResponse.json(result)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The agent could not look"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
