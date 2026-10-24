import type { Metadata } from "next"
import Link from "next/link"
import { AppFrame } from "../components/app-frame"
import { fmtDateTime } from "@/lib/present/time"
import { loadDriverPhone } from "@/lib/room/driver-view"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Driver · Control Room" }

export default async function DrivePage() {
  let phone = null
  let error = ""
  try {
    phone = await loadDriverPhone()
  } catch {
    error = "Could not load the driver chat. Check that the local database is running and seeded."
  }

  return <AppFrame section="room" snapshotAt={phone?.snapshotAt ?? null}>
    <main className="page">
      <div className="drive-head">
        <p className="drive-kicker"><Link href="/room">To decide</Link> · what the driver sees</p>
        <h1>{phone ? phone.driver : "Driver"}</h1>
        {phone && <p>{phone.vehicle} · <span className="mono">{phone.reference}</span>. Stopped. Engine off. Waiting.</p>}
      </div>
      {error && <p className="room-note" role="alert">{error}</p>}
      {!error && !phone && <p className="room-note">No open stop for a driver to see.</p>}
      {phone && <div className="drive-phone">
        <ol className="drive-thread">
          {phone.lines.map((line) => <li key={line.id} className={line.mine ? "mine" : "desk"}>
            <p className="drive-who">{line.who}</p>
            <p className="drive-body">{line.body}</p>
            <p className="drive-time"><time dateTime={line.at}>{fmtDateTime(line.at, phone.zone)}</time></p>
          </li>)}
        </ol>
        <p className="drive-waiting">His last line is still the open question. He will not move the car until someone tells him who is collecting it.</p>
        {phone.pending ? <aside className="drive-pending">
          <p className="drive-who">Approved for the driver · {fmtDateTime(phone.pending.at, phone.zone)}</p>
          <p className="drive-body">{phone.pending.text}</p>
          <p className="drive-time">Recorded in this room. The snapshot chat is unchanged, and no customer was contacted.</p>
        </aside> : <p className="drive-waiting">The desk has not approved a next message.</p>}
      </div>}
    </main>
  </AppFrame>
}
