import { NextResponse } from "next/server"
import { saveInvestigation } from "@/lib/agent/session"
import { loadOrder } from "@/lib/present/load"
import { kindFor } from "@/lib/room/kinds"

export const runtime = "nodejs"

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const loaded = await loadOrder(id)
  if (!loaded) return NextResponse.json({ error: "Order not found" }, { status: 404 })
  const kind = kindFor(loaded.bundle)
  if (!kind) return NextResponse.json({ error: "No deep case for this order" }, { status: 400 })
  try {
    const result = await kind.investigate(loaded.bundle)
    await saveInvestigation(id, result)
    return NextResponse.json(result)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The agent could not look"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
