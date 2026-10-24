import type { Metadata } from "next"
import Link from "next/link"
import { AppFrame } from "./components/app-frame"
import { Chip } from "./components/ui"
import { Icon } from "./components/icons"
import type { Tone } from "@/lib/present/types"

export const metadata: Metadata = { title: "Control Room — how it works" }

const STEPS: { icon: string; title: string; body: string }[] = [
  { icon: "bot", title: "Agents watch the whole fleet", body: "A hundred orders are moving at once. Agents read every one, gather the facts, and keep the calm ones off your screen." },
  { icon: "flag", title: "You see only what needs a person", body: "Each card shows what happened, where every fact came from, and the few decisions actually in front of you — nothing else." },
  { icon: "check", title: "Nothing happens without your yes", body: "Reading and asking are free. A message, a booking, a date, or anything to a customer waits for you. Approving records the decision — it does not send anything, and the case stays open until the facts are in." },
]

const ANATOMY: { label: string; body: string }[] = [
  { label: "Kicker + reference", body: "The area and urgency, and the order reference, so you know what you are looking at in a glance." },
  { label: "Headline & summary", body: "Plain language: what is going on and why it needs you. No codes, no jargon." },
  { label: "Still missing", body: "The facts that are not in yet — the reason the case can’t simply close." },
  { label: "The decisions", body: "A few choices, each on its own. Approve, edit, or reject — one at a time." },
  { label: "What the records say", body: "Every fact links to the message, alert, or booking it came from. You can always check the source." },
  { label: "Look again with the agent", body: "Re-run the agent live. It shows the tools it used, and any draft a guard refused before you could approve it." },
]

const AREAS: { kicker: string; tone: Tone; area: string; order: string; decision: string; rule: string; proactive?: boolean }[] = [
  { kicker: "Vehicle warning", tone: "danger", area: "On the Road", order: "CD-420322", decision: "A car is stopped and the driver is safe. Ask for the exact place and a photo, hold the promise, or make the owner call.", rule: "Never diagnoses the fault and never clears the car to drive." },
  { kicker: "Crossing at risk", tone: "warn", area: "Driver Travel", order: "CD-420299", decision: "A ferry sold out; the later sailing is a quote only. Tell the driver, propose a rebook for approval, hold the promise.", rule: "A quote is not a booking. It never books and never moves the promise." },
  { kicker: "Pickup unresolved", tone: "warn", area: "Pickup Readiness", order: "CD-420593", decision: "The site has “a similar car.” Ask it to confirm the exact VIN and hold collection.", rule: "A similar stock reference is not a VIN match. It never substitutes or marks the car collected." },
  { kicker: "Promise at risk", tone: "accent", area: "Promise Guardian", order: "CD-420702", decision: "A delivery promise will be missed. Flag it, propose a revised date for approval — the customer call is yours.", rule: "Never writes a new promise and never emails the customer.", proactive: true },
  { kicker: "Support inbox", tone: "accent", area: "Driver Support", order: "the inbox", decision: "Answer a routine question from the record, ask for a reference when the match is unclear, or refuse to reveal anything on an unverified one.", rule: "Never reveals details for a reference that belongs to another account." },
]

const RULES: string[] = [
  "The agent never contacts a customer on its own. Customer-facing steps are scripts a person makes the call on.",
  "Approvals first. Reading and asking need no yes; a change always does. Trust can widen later.",
  "Every fact is cited to its record, so you can see where it came from and when.",
  "Approving sends nothing and never changes the data. The case stays open until the facts are in.",
  "The agent is a real model doing the work in a loop, inside hard rules enforced in code.",
]

export default function Home() {
  return <AppFrame section="welcome">
    <main className="page">
      <section className="onboard-hero">
        <Chip tone="accent" dot>Welcome</Chip>
        <h1 className="page-title">The room where people and agents get every car delivered.</h1>
        <p className="onboard-lead">
          Bahn moves cars across Europe with freelance drivers, and something changes every hour. ControlRoom lets
          agents do the legwork across the whole fleet and brings you only the orders that need a person — with the
          evidence already gathered and the decision laid out.
        </p>
        <div className="onboard-cta">
          <Link className="room-btn primary" href="/room">Enter the control room →</Link>
          <Link className="room-btn" href="/drive">See the driver’s view</Link>
          <Link className="room-btn" href="/board">Lane board</Link>
        </div>
      </section>

      <section className="onboard-block">
        <h2 className="onboard-h2">How it works, in one minute</h2>
        <div className="onboard-steps">
          {STEPS.map((step, index) => <div className="onboard-step" key={step.title}>
            <div className="onboard-step-mark"><Icon name={step.icon} size={18} /><span className="onboard-step-num">{index + 1}</span></div>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>)}
        </div>
      </section>

      <section className="onboard-block">
        <h2 className="onboard-h2">How to read a decision card</h2>
        <p className="onboard-sub">Every card is built the same way, so a glance tells you what is wrong and what to do.</p>
        <dl className="onboard-anatomy">
          {ANATOMY.map((row) => <div className="onboard-anatomy-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.body}</dd>
          </div>)}
        </dl>
      </section>

      <section className="onboard-block">
        <h2 className="onboard-h2">Five areas, each a real agent</h2>
        <p className="onboard-sub">Every area reads the records, does the cheap work first, and stops when a fact is missing. The colour is urgency, not area.</p>
        <div className="onboard-areas">
          {AREAS.map((area) => <article className="onboard-area" key={area.area}>
            <div className="onboard-area-top">
              <Chip tone={area.tone} dot>{area.kicker}</Chip>
              {area.proactive && <span className="onboard-tag">proactive</span>}
            </div>
            <h3>{area.area}</h3>
            <p className="onboard-area-decision">{area.decision}</p>
            <p className="onboard-area-rule"><Icon name="check" size={13} /> {area.rule}</p>
            <p className="onboard-area-eg">Example · <span className="mono">{area.order}</span></p>
          </article>)}
        </div>
      </section>

      <section className="onboard-block">
        <h2 className="onboard-h2">The rules we keep</h2>
        <ul className="onboard-rules">
          {RULES.map((rule) => <li key={rule}><Icon name="check" size={14} /><span>{rule}</span></li>)}
        </ul>
      </section>

      <section className="onboard-foot">
        <Link className="room-btn primary" href="/room">Enter the control room →</Link>
        <p>Everything here is a fictional snapshot — read only. No real people, cars, or messages.</p>
      </section>
    </main>
  </AppFrame>
}
