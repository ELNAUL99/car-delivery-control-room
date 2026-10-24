import { NextResponse } from "next/server"
import { loadRoom } from "@/lib/room/load"

export const runtime = "nodejs"

export async function GET() {
  try {
    return NextResponse.json(await loadRoom())
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not load the queue"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
