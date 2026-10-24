import type { Metadata } from "next"
import { AppFrame } from "../components/app-frame"
import { RoomView } from "../components/room-view"
import { loadRoom } from "@/lib/room/load"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "To decide · Control Room" }

export default async function RoomPage() {
  let room = null
  let error = ""
  try {
    room = await loadRoom()
  } catch {
    error = "Could not load orders. Check that the local database is running and seeded."
  }
  return <AppFrame section="room" snapshotAt={room?.snapshotAt ?? null}>
    <main className="page">
      <RoomView initial={room} error={error} />
    </main>
  </AppFrame>
}
