import { NextResponse } from "next/server"
import { loadInvestigation, saveInvestigation } from "@/lib/agent/session"
import { withTurn } from "@/lib/agent/talk"
import { loadOrder } from "@/lib/present/load"
import { kindFor } from "@/lib/room/kinds"

export const runtime = "nodejs"

async function noteOf(request: Request): Promise<string> {
  const body = await request.json().catch(() => null) as { note?: unknown } | null
  return typeof body?.note === "string" ? body.note.trim().slice(0, 500) : ""
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const note = await noteOf(request)
  const loaded = await loadOrder(id)
  if (!loaded) return NextResponse.json({ error: "Order not found" }, { status: 404 })
  const kind = kindFor(loaded.bundle)
  if (!kind) return NextResponse.json({ error: "No deep case for this order" }, { status: 400 })
  const previous = await loadInvestigation(id)
  const stopped = kind.halt(loaded.bundle)
  if (stopped) {
    const card = kind.buildCard(loaded.bundle)
    if (!card) return NextResponse.json({ error: "No deep case for this order" }, { status: 400 })
    const result = withTurn({
      ok: false,
      error: stopped,
      card,
      trace: [{ tool: "stop", summary: stopped }],
      refusedDraft: null,
      reply: stopped,
    }, previous, note)
    await saveInvestigation(id, result)
    return NextResponse.json(result)
  }
  try {
    const result = withTurn(await kind.investigate(loaded.bundle, note || undefined, previous?.turns), previous, note)
    await saveInvestigation(id, result)
    return NextResponse.json(result)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The agent could not look"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
