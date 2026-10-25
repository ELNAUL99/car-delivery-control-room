"use client"

import Link from "next/link"
import { useState } from "react"
import { Chip, More, When } from "@/app/components/ui"
import { Icon } from "@/app/components/icons"
import { fmtRange } from "@/lib/present/time"
import type { ActionId, AgentTrace, AgentTurn, CitedFact, Investigation, PickupCall, RoomCard, RoomCase, RoomPayload, SessionDecision, SupportCase } from "@/lib/room/types"

const SECTIONS: Record<CitedFact["kind"], string> = {
  message: "conversations",
  incident: "work",
  alert: "work",
  work: "work",
  proposal: "decisions",
  document: "evidence",
  window: "journey",
  tracking: "journey",
  offer: "journey",
  reservation: "journey",
  inbox: "conversations",
}

type AgentState = { error: string; trace: AgentTrace[] | null; refused: string | null; turns: AgentTurn[] }

function emptyAgent(): AgentState {
  return { error: "", trace: null, refused: null, turns: [] }
}

function agentState(result: Investigation & { error?: string }, previous: AgentState): AgentState {
  return {
    error: result.error ?? "",
    trace: result.trace?.length ? result.trace : previous.trace,
    refused: result.refusedDraft ?? null,
    turns: result.turns ?? previous.turns,
  }
}

function agentsFrom(initial: RoomPayload | null): Record<string, AgentState> {
  const map: Record<string, AgentState> = {}
  for (const [id, inv] of Object.entries(initial?.investigations ?? {})) {
    map[id] = { error: inv.error ?? "", trace: inv.trace?.length ? inv.trace : null, refused: inv.refusedDraft ?? null, turns: inv.turns ?? [] }
  }
  return map
}

export function RoomView({ initial, error }: { initial: RoomPayload | null; error?: string }) {
  const [heroes, setHeroes] = useState(initial?.heroes ?? [])
  const [decisions, setDecisions] = useState(initial?.decisions ?? [])
  const [agents, setAgents] = useState<Record<string, AgentState>>(() => agentsFrom(initial))
  const [support, setSupport] = useState(initial?.support ?? [])
  const rest = initial?.rest ?? []
  const needing = heroes.length + rest.length + support.length

  return <>
    <header className="room-head">
      <div className="room-head-top">
        <h1>To decide</h1>
        <Link className="room-textlink" href="/">New here? How this works →</Link>
      </div>
      <p>{error
        ? "The queue could not be loaded."
        : needing === 0
          ? "Nothing in this snapshot is waiting on a person."
          : <>{needing} {needing === 1 ? "order needs" : "orders need"} a person. {heroes.length} {heroes.length === 1 ? "has" : "have"} a decision ready. Everything else stays on the board.</>}</p>
    </header>
    {!error && initial?.stats && <div className="room-counts" aria-label="Fleet at a glance">
      <span><b className="num">{initial.stats.quiet}</b> of {initial.stats.total} orders checked and quiet</span>
      <span><b className="num">{initial.stats.openAlerts}</b> with an open alert</span>
      <span><b className="num">{initial.stats.ready}</b> with a decision ready</span>
      {initial.stats.stopped > 0 && <span><b className="num">{initial.stats.stopped}</b> where the agent stopped</span>}
      {initial.stats.bahnWorking > 0 && <span>Bahn already owns <b className="num">{initial.stats.bahnWorking}</b> with a due time</span>}
    </div>}
    {error && <p className="board-error" role="alert">{error}</p>}
    {heroes.map((item) => <Hero
      key={`${item.id}:${item.card?.source}:${item.card?.actions.map((action) => action.draft ?? "").join("\n")}`}
      item={item}
      snapshotAt={initial?.snapshotAt ?? null}
      decisions={decisions.filter((decision) => decision.orderId === item.id)}
      agent={agents[item.id] ?? emptyAgent()}
      onDecided={(decision) => setDecisions((current) => [...current.filter((known) => !(known.orderId === decision.orderId && known.actionId === decision.actionId)), decision])}
      onInvestigated={(card, next) => {
        setHeroes((current) => current.map((hero) => hero.id === card.orderId ? { ...hero, card } : hero))
        setAgents((current) => ({ ...current, [card.orderId]: next }))
      }}
    />)}
    {support.length > 0 && <section className="room-support" aria-label="Driver support inbox">
      <h2>Driver support — inbox</h2>
      {support.map((item) => <SupportCard
        key={`${item.threadId}:${item.card.source}:${item.card.actions.map((a) => a.draft ?? "").join("\n")}`}
        item={item}
        snapshotAt={initial?.snapshotAt ?? null}
        decisions={decisions.filter((decision) => decision.orderId === item.threadId)}
        agent={agents[item.threadId] ?? emptyAgent()}
        onDecided={(decision) => setDecisions((current) => [...current.filter((known) => !(known.orderId === decision.orderId && known.actionId === decision.actionId)), decision])}
        onInvestigated={(card, next) => {
          setSupport((current) => current.map((s) => s.threadId === item.threadId ? { ...s, card } : s))
          setAgents((current) => ({ ...current, [item.threadId]: next }))
        }}
      />)}
    </section>}
    {rest.length > 0 && <section className="room-rest" aria-label="Other orders that need a person">
      <h2>Also waiting</h2>
      <ul>{rest.map((item) => <li key={item.id}><QueueRow item={item} /></li>)}</ul>
    </section>}
  </>
}

function SupportCard({ item, snapshotAt, decisions, agent, onDecided, onInvestigated }: {
  item: SupportCase
  snapshotAt: string | null
  decisions: SessionDecision[]
  agent: AgentState
  onDecided: (decision: SessionDecision) => void
  onInvestigated: (card: RoomCard, agent: AgentState) => void
}) {
  const card = item.card
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(card.actions.map((action) => [action.id, action.draft ?? ""])))
  const [pending, setPending] = useState<string | null>(null)
  const [effects, setEffects] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<Record<string, string>>({})
  const refs = (item.linked.length ? item.linked : item.candidates)

  async function lookAgain(note?: string) {
    setPending("agent")
    try {
      const response = await fetch(`/api/support/${item.threadId}/investigate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note ?? "" }),
      })
      const result = await response.json() as Investigation & { error?: string }
      if (!response.ok || !result.card) {
        onInvestigated(card, { error: result.error ?? "The agent could not look.", trace: agent.trace, refused: agent.refused, turns: agent.turns })
        return
      }
      onInvestigated(result.card, agentState(result, agent))
    } catch {
      onInvestigated(card, { error: "The agent could not look.", trace: agent.trace, refused: agent.refused, turns: agent.turns })
    } finally {
      setPending(null)
    }
  }

  async function decide(actionId: ActionId, choice: "approved" | "rejected", sendable: boolean) {
    const original = card.actions.find((action) => action.id === actionId)?.draft ?? ""
    const text = drafts[actionId] ?? ""
    const sentChoice = choice === "approved" && sendable && text.trim() !== original.trim() ? "edited" : choice
    setPending(actionId)
    setActionError((current) => ({ ...current, [actionId]: "" }))
    try {
      const response = await fetch(`/api/support/${item.threadId}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId, choice: sentChoice, text }),
      })
      const result = await response.json() as { error?: string; decision?: SessionDecision; effect?: string }
      if (!response.ok || !result.decision) {
        setActionError((current) => ({ ...current, [actionId]: result.error ?? "Could not record the decision." }))
        return
      }
      onDecided(result.decision)
      setEffects((current) => ({ ...current, [actionId]: result.effect ?? "Recorded." }))
    } catch {
      setActionError((current) => ({ ...current, [actionId]: "Could not record the decision." }))
    } finally {
      setPending(null)
    }
  }

  return <article className="room-hero">
    <div className="room-kicker">
      <Chip tone={item.tone} dot>{card.kicker}</Chip>
      <span>{item.categoryLabel} · {item.linkStateLabel}</span>
      {refs.length > 0 && <span className="mono">{refs.map((r) => r.reference).join(", ")}</span>}
    </div>
    <h2>{card.headline}</h2>
    <p className="room-summary">{card.summary}</p>
    <ul className="room-missing">{card.missing.map((itemText) => <li key={itemText}>{itemText}</li>)}</ul>

    <div className="room-toolbar">
      <button type="button" className="room-btn" onClick={() => lookAgain()} disabled={pending !== null}>
        {pending === "agent" ? "Looking…" : "Look again with the agent"}
      </button>
      {refs[0] && <Link className="room-textlink" href={`/orders/${refs[0].id}#conversations`}>Open the order</Link>}
      {card.source === "agent" && <span className="room-source">Agent drafted the reply. The thread below is the record.</span>}
    </div>
    {agent.error?.startsWith("Agent stopped") ? <p className="room-stopped" role="status">{agent.error}</p> : agent.error && <p className="room-note" role="status">{agent.error}</p>}
    {agent.refused && <p className="room-refused">This reply was refused before it could be approved: “{agent.refused}”</p>}
    {agent.trace && agent.trace.length > 0 && <More label="What the agent looked up">
      <ul className="room-trace">{agent.trace.map((step, index) => <li key={`${step.tool}-${index}`}><b>{step.tool}</b> {step.summary}</li>)}</ul>
    </More>}

    <section className="room-block" aria-label="Decisions">
      <h3>Answer, link or escalate</h3>
      {card.actions.map((action) => {
        const decision = decisions.find((itemDecision) => itemDecision.actionId === action.id)
        return <div className="room-action" key={action.id}>
          <h4>{action.title}</h4>
          <p>{action.whatChanges}</p>
          {action.draft !== null && (action.sendable ? <label className="room-label">
            <span className="sr-only">Reply text</span>
            <textarea className="room-draft" value={drafts[action.id] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [action.id]: event.target.value }))} />
          </label> : <p className="room-script">{action.draft}</p>)}
          {decision && <p className="room-effect">{choiceLabel(decision)} · <When at={decision.at} snapshotAt={snapshotAt} withZone={false} /></p>}
          {(effects[action.id] || decision?.effect) && <p className={`room-exec${(effects[action.id] ?? decision?.effect ?? "").includes("contact the customer yourself") ? " customer" : ""}`}><b>What happens next</b> {effects[action.id] ?? decision?.effect}</p>}
          {actionError[action.id] && <p className="room-note" role="alert">{actionError[action.id]}</p>}
          <div className="room-buttons">
            <button type="button" className="room-btn primary" disabled={pending !== null} onClick={() => decide(action.id, "approved", action.sendable)}>
              {action.sendable ? "Approve this reply" : "Approve"}
            </button>
            <button type="button" className="room-btn" disabled={pending !== null} onClick={() => decide(action.id, "rejected", action.sendable)}>Not this</button>
          </div>
        </div>
      })}
      <p className="room-foot">Approving here does not send anything and does not change the snapshot.</p>
    </section>
    <AskAgent pending={pending} turns={agent.turns} onAsk={(note) => lookAgain(note)} />

    <section className="room-block" aria-label="The thread">
      <h3>The thread</h3>
      <ol className="room-facts">{card.facts.map((fact) => <li key={fact.recordId}><p>{fact.text}</p><p className="room-cite">{fact.at && <When at={fact.at} snapshotAt={snapshotAt} withZone={false} />}<span className={`fact-src ${factSource(fact)}`}>{factSource(fact)}</span><span>{fact.source}</span>{fact.state && <span className={`fact-state ${fact.state}`}>{fact.state}</span>}</p></li>)}</ol>
    </section>
  </article>
}

function Hero({ item, snapshotAt, decisions, agent, onDecided, onInvestigated }: {
  item: RoomCase
  snapshotAt: string | null
  decisions: SessionDecision[]
  agent: AgentState
  onDecided: (decision: SessionDecision) => void
  onInvestigated: (card: RoomCard, agent: AgentState) => void
}) {
  const card = item.card
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries((card?.actions ?? []).map((action) => [action.id, action.draft ?? ""])))
  const [pending, setPending] = useState<string | null>(null)
  const [effects, setEffects] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<Record<string, string>>({})
  if (!card) return null
  const date = item.decisive

  async function lookAgain(note?: string) {
    setPending("agent")
    try {
      const response = await fetch(`/api/orders/${item.id}/investigate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note ?? "" }),
      })
      const result = await response.json() as Investigation & { error?: string }
      if (!response.ok || !result.card) {
        onInvestigated(card!, { error: result.error ?? "The agent could not look.", trace: agent.trace, refused: agent.refused, turns: agent.turns })
        return
      }
      onInvestigated(result.card, agentState(result, agent))
    } catch {
      onInvestigated(card!, { error: "The agent could not look.", trace: agent.trace, refused: agent.refused, turns: agent.turns })
    } finally {
      setPending(null)
    }
  }

  async function decide(actionId: ActionId, choice: "approved" | "rejected", sendable: boolean) {
    const original = card?.actions.find((action) => action.id === actionId)?.draft ?? ""
    const text = drafts[actionId] ?? ""
    const sentChoice = choice === "approved" && sendable && text.trim() !== original.trim() ? "edited" : choice
    setPending(actionId)
    setActionError((current) => ({ ...current, [actionId]: "" }))
    try {
      const response = await fetch(`/api/orders/${item.id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId, choice: sentChoice, text }),
      })
      const result = await response.json() as { error?: string; decision?: SessionDecision; effect?: string }
      if (!response.ok || !result.decision) {
        setActionError((current) => ({ ...current, [actionId]: result.error ?? "Could not record the decision." }))
        return
      }
      onDecided(result.decision)
      setEffects((current) => ({ ...current, [actionId]: result.effect ?? "Recorded." }))
    } catch {
      setActionError((current) => ({ ...current, [actionId]: "Could not record the decision." }))
    } finally {
      setPending(null)
    }
  }

  return <article className="room-hero">
    <div className="room-kicker">
      <Chip tone={item.tone} dot>{card.kicker}</Chip>
      <span className="mono">{item.reference}</span>
      <span>{item.customer}</span>
    </div>
    <h2>{card.headline}</h2>
    <p className="room-route">{item.origin} → {item.destination}</p>
    <p className="room-summary">{card.summary}</p>
    {date && <p className={`room-date tone-${date.tone}`}>{date.label}: {date.end ? fmtRange(date.start, date.end, date.zone) : null}{date.note ? ` · ${date.note}` : ""}</p>}
    <ul className="room-missing">{card.missing.map((itemText) => <li key={itemText}>{itemText}</li>)}</ul>

    <div className="room-toolbar">
      <button type="button" className="room-btn" onClick={() => lookAgain()} disabled={pending !== null}>
        {pending === "agent" ? "Looking…" : "Look again with the agent"}
      </button>
      <Link className="room-textlink" href={`/orders/${item.id}#attention`}>Open the order</Link>
      {card.kind === "on_the_road" && <Link className="room-textlink" href="/drive">What the driver sees</Link>}
      {card.source === "agent" && <span className="room-source">Agent rewrote the reading. The facts below are still the records.</span>}
    </div>
    {agent.error?.startsWith("Agent stopped") ? <p className="room-stopped" role="status">{agent.error}</p> : agent.error && <p className="room-note" role="status">{agent.error}</p>}
    {agent.refused && <p className="room-refused">This draft was refused before it could be approved: “{agent.refused}”</p>}
    {agent.trace && agent.trace.length > 0 && <More label="What the agent looked up">
      <ul className="room-trace">{agent.trace.map((step, index) => <li key={`${step.tool}-${index}`}><b>{step.tool}</b> {step.summary}</li>)}</ul>
    </More>}

    {card.kind === "pickup_readiness" && <PickupPhone orderId={item.id} />}
    <section className="room-block" aria-label="Decisions">
      <h3>{card.actions.length === 3 ? "Three decisions, each on its own" : "Decisions, each on its own"}</h3>
      {card.actions.map((action) => {
        const decision = decisions.find((itemDecision) => itemDecision.actionId === action.id)
        return <div className="room-action" key={action.id}>
          <h4>{action.title}</h4>
          <p>{action.whatChanges}</p>
          {action.draft !== null && (action.sendable ? <label className="room-label">
            <span className="sr-only">Message text</span>
            <textarea className="room-draft" value={drafts[action.id] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [action.id]: event.target.value }))} />
          </label> : <p className="room-script">{action.draft}</p>)}
          {decision && <p className="room-effect">{choiceLabel(decision)} · <When at={decision.at} snapshotAt={snapshotAt} withZone={false} /></p>}
          {(effects[action.id] || decision?.effect) && <p className={`room-exec${(effects[action.id] ?? decision?.effect ?? "").includes("contact the customer yourself") ? " customer" : ""}`}><b>What happens next</b> {effects[action.id] ?? decision?.effect}</p>}
          {actionError[action.id] && <p className="room-note" role="alert">{actionError[action.id]}</p>}
          <div className="room-buttons">
            <button type="button" className="room-btn primary" disabled={pending !== null} onClick={() => decide(action.id, "approved", action.sendable)}>
              {action.sendable ? "Approve this message" : "Approve"}
            </button>
            <button type="button" className="room-btn" disabled={pending !== null} onClick={() => decide(action.id, "rejected", action.sendable)}>Not this</button>
          </div>
        </div>
      })}
      <p className="room-foot">The case stays open until the facts are in the record. Approving here does not send anything and does not change the snapshot.</p>
    </section>
    <AskAgent pending={pending} turns={agent.turns} onAsk={(note) => lookAgain(note)} />

    <section className="room-block" aria-label="What the records say">
      <h3>What the records say</h3>
      <ol className="room-facts">{card.facts.map((fact) => <FactRow key={`${fact.kind}-${fact.recordId}-${fact.at}`} fact={fact} orderId={item.id} snapshotAt={snapshotAt} />)}</ol>
    </section>
    {card.alreadyDone.length > 0 && <section className="room-block" aria-label="What already happened">
      <h3>Already done, and still open</h3>
      <ol className="room-facts">{card.alreadyDone.map((fact) => <FactRow key={`${fact.kind}-${fact.recordId}`} fact={fact} orderId={item.id} snapshotAt={snapshotAt} />)}</ol>
    </section>}
  </article>
}

function FactRow({ fact, orderId, snapshotAt }: { fact: CitedFact; orderId: string; snapshotAt: string | null }) {
  return <li>
    <p>{fact.text}</p>
    <p className="room-cite">
      {fact.at && <When at={fact.at} snapshotAt={snapshotAt} withZone={false} />}
      <span className={`fact-src ${factSource(fact)}`}>{factSource(fact)}</span>
      <span>{fact.source}</span>
      {fact.state && <span className={`fact-state ${fact.state}`}>{fact.state}</span>}
      <Link className="ref-link" href={`/orders/${orderId}#${SECTIONS[fact.kind]}`}>{fact.recordId}</Link>
    </p>
  </li>
}

function AskAgent({ pending, turns, onAsk }: { pending: string | null; turns: AgentTurn[]; onAsk: (note: string) => void }) {
  const [note, setNote] = useState("")
  return <form className="room-ask" onSubmit={(event) => { event.preventDefault(); const text = note.trim(); if (!text) return; setNote(""); onAsk(text) }}>
    {(turns.length > 0 || pending === "agent") && <div className="room-log">
      {turns.map((turn) => <div className="room-exchange" key={turn.at}>
        <p className="room-turn you"><b>You</b> {turn.text}</p>
        {turn.reply && <p className="room-turn agent"><b>Agent</b> {turn.reply}</p>}
      </div>)}
      {pending === "agent" && <p className="room-turn agent">Looking at the records…</p>}
    </div>}
    <label className="room-label">
      <span>Talk to the agent</span>
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ask the driver for the place, or ask the pickup site to match the VIN" />
    </label>
    <button type="submit" className="room-btn" disabled={pending !== null || note.trim().length === 0}>{pending === "agent" ? "Asking…" : "Send"}</button>
  </form>
}

function QueueRow({ item }: { item: RoomCase }) {
  const date = item.decisive
  return <Link className="room-row" href={`/orders/${item.id}#attention`}>
    <span className={`room-row-mark tone-${item.tone}`} aria-hidden="true"><Icon name="alert" size={14} /></span>
    <span className="room-row-main">
      <span className="room-row-title">{item.vehicle} <span className="mono">{item.reference}</span></span>
      <span className="room-row-line">{item.line}{item.more > 0 ? ` · +${item.more} more` : ""}</span>
      {item.detail && <span className="room-row-detail">{item.detail}</span>}
    </span>
    <span className="room-row-side">
      <span>{item.origin} → {item.destination}</span>
      {date && <span className={`tone-${date.tone}`}>{date.label}{date.note ? ` · ${date.note}` : ""}</span>}
    </span>
  </Link>
}

function choiceLabel(decision: SessionDecision): string {
  if (decision.choice === "rejected") return "Not this"
  if (decision.choice === "edited") return "Edited, then approved"
  return "Approved"
}

const WHO: Record<string, string> = { ivr: "Menu", agent: "Agent", desk: "Branch desk", system: "" }

function PickupPhone({ orderId }: { orderId: string }) {
  const [call, setCall] = useState<PickupCall | null>(null)
  const [busy, setBusy] = useState(false)
  async function dial() {
    setBusy(true)
    try {
      const response = await fetch(`/api/orders/${orderId}/call`, { method: "POST" })
      if (response.ok) setCall(await response.json() as PickupCall)
    } catch {
      /* leave call as-is */
    } finally {
      setBusy(false)
    }
  }
  return <section className="room-block pickup-phone" aria-label="Pickup readiness by phone">
    <h3>Pickup readiness — by phone</h3>
    <p className="room-note">The driver is at the pickup place. The agent can call the branch to confirm readiness. Calling to ask needs no approval, and the pickup place is fine to contact.</p>
    <button type="button" className="room-btn" onClick={dial} disabled={busy}>
      {busy ? "Calling…" : call ? "Call again" : "Call the pickup place"}
    </button>
    {call && <div className="call">
      <ol className="call-log">{call.transcript.map((line, index) => <li key={index} className={`call-${line.who}`}>
        {WHO[line.who] && <b>{WHO[line.who]}</b>} {line.text}
      </li>)}</ol>
      <ul className="call-check">{call.checklist.map((item) => <li key={item.label} className={item.ok ? "ok" : "no"}>
        <span className="call-mark">{item.ok ? "✓" : "✗"}</span> <b>{item.label}</b> — {item.note}
      </li>)}</ul>
      <p className={`call-outcome ${call.ready ? "ok" : "no"}`}>{call.outcome} · {call.attempts} attempts ({call.reached ? "reached after a retry" : "no answer"})</p>
    </div>}
  </section>
}

// Who the fact came from, as a fixed taxonomy (OPERATIONS-CONTEXT: a quote is not
// a booking, a driver message is not a fresh location). Uses the fact's own `src`
// when set, else derives it from the kind and the source label — no area-module
// change needed.
function factSource(fact: CitedFact): string {
  if (fact.src) return fact.src
  const s = (fact.source ?? "").toLowerCase()
  if (fact.kind === "message" || fact.kind === "inbox") {
    if (s.includes("driver")) return "driver"
    if (s.includes("customer")) return "customer"
    if (s.includes("site")) return "site"
    if (s.includes("support")) return "support"
    if (s.includes("internal") || s.includes("case") || s.includes("note")) return "ops"
    return "message"
  }
  if (fact.kind === "alert") return "system"
  if (fact.kind === "tracking") return "app"
  if (fact.kind === "reservation" || fact.kind === "offer") return "ferry"
  if (fact.kind === "window") return "customer"
  if (fact.kind === "document") return "document"
  if (fact.kind === "incident") return "site"
  if (fact.kind === "proposal") return "agent"
  if (fact.kind === "work") return "ops"
  return "record"
}
