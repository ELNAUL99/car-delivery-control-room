// Driver Support — the support inbox. Each open thread is a case. The agent reads
// the thread and its link basis, then decides: answer a routine question with a
// cited source, ask for a reference when the match is ambiguous, or refuse to
// reveal anything when the reference belongs to another account. The last one — an
// unverified claim, not an order link — is the case a person most needs surfaced.

import { eq, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { orders, relatedRecords } from "@/lib/schema"
import { label } from "@/lib/present/labels"
import { str } from "@/lib/present/bundle"
import { EMPTY_PARAMETERS, fn, runAgent, textOf } from "@/lib/agent/run-agent"
import { fact } from "./cite"
import type { AgentTurn, CitedFact, Investigation, RoomAction, RoomCard, SupportCase } from "./types"

type Row = Record<string, unknown>
type Msg = { id: string; author: string; at: string | null; body: string }

const SENSITIVE = /\b(car|vehicle|route|buyer|dealer|driver|destination|eta|arriv|plate|vin|address)\b/

export function supportReplyProblem(text: string, linkState: string): string | null {
  const t = text.trim()
  if (t.length < 15) return "The reply is too short to send."
  const lower = t.toLowerCase()
  if (linkState === "PENDING_IDENTITY") {
    if (SENSITIVE.test(lower)) return "The sender is not verified for this reference — the reply must not reveal car, route, buyer or driver details."
    if (!/reference|account|confirm|verify|booking/.test(lower)) return "Ask the sender to confirm the reference on their own booking before anything is shared."
  }
  if (/\b(signed|ready to collect|handover complete|paid|reimbursed|paid out)\b/.test(lower.replace(/not (yet )?(signed|ready|paid|reimbursed)/g, ""))) {
    return "The reply states a document is signed or a payout is made; the records do not confirm that."
  }
  return null
}

function toneFor(linkState: string): SupportCase["tone"] {
  if (linkState === "PENDING_IDENTITY") return "danger"
  if (linkState === "PENDING_MATCH") return "warn"
  return "accent"
}

async function orderRefs(ids: string[]): Promise<{ id: string; reference: string }[]> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (!unique.length) return []
  const rows = await db.select({ id: orders.id, reference: orders.reference }).from(orders).where(inArray(orders.id, unique))
  return rows
}

function buildCard(thread: { id: string; details: Row }, messages: Msg[], refs: Map<string, string>): SupportCase {
  const d = thread.details
  const category = str(d.category) ?? "support"
  const channel = str(d.channel) ?? "message"
  const linkState = str(d.link_state) ?? "PENDING_MATCH"
  const waitingOn = str(d.waiting_on)
  const basis = str(d.candidate_basis)
  const candidateIds = Array.isArray(d.candidate_order_ids) ? d.candidate_order_ids.filter((x): x is string => typeof x === "string") : []
  const linkedIds = Array.isArray(d.linked_order_ids) ? d.linked_order_ids.filter((x): x is string => typeof x === "string") : []
  const candidates = candidateIds.map((id) => ({ id, reference: refs.get(id) ?? id }))
  const linked = linkedIds.map((id) => ({ id, reference: refs.get(id) ?? id }))
  const impostor = linkState === "PENDING_IDENTITY"
  const ambiguous = linkState === "PENDING_MATCH"

  const facts: CitedFact[] = messages.map((m) => fact(`${m.author}: “${m.body}”`, `Support · ${label(channel)}`, m.id, "inbox", m.at, "reported"))
  if (basis) facts.push(fact(basis, "Link basis", thread.id, "inbox", null, impostor || ambiguous ? "disputed" : "recorded"))

  const refList = (linked.length ? linked : candidates).map((o) => o.reference).join(", ")

  const headline = impostor
    ? `Unverified sender quoting a reference that is not on their account`
    : ambiguous
      ? `Driver message can't be matched to one job yet`
      : `Support request on ${refList || "a matched order"}`
  const summary = impostor
    ? `The quoted reference belongs to another account — an unverified claim, not an order link. Do not reveal any car, route, buyer or driver detail; ask the sender to confirm the reference on their own booking.`
    : ambiguous
      ? `The same driver has more than one upcoming job and the message names no car or location. Ask for the job reference before anything is answered; do not guess.`
      : `${label(category)} on ${refList}. ${basis ?? ""} Answer with what the record supports — nothing it does not.`

  const missing = impostor
    ? ["The sender's identity for this reference is not verified.", "No order link is confirmed; nothing is shared until it is."]
    : ambiguous
      ? ["Which of the driver's jobs this concerns is not established.", "No answer is sent until the reference is confirmed."]
      : [waitingOn ? `Waiting on ${label(waitingOn)}.` : "The routine answer is not yet sent.", "Nothing is overstated beyond the record."]

  const actions: RoomAction[] = [
    {
      id: "answer",
      title: impostor ? "Reply asking for a verified reference (reveal nothing)" : ambiguous ? "Reply asking for the job reference" : "Reply with the sourced answer",
      whatChanges: "One reply in the exact text you approve. Nothing is sent from here; the snapshot is not changed.",
      draft: impostor
        ? `I can't match that reference to your account, so I can't share any details. Please check the reference on your own booking confirmation and send the corrected one.`
        : ambiguous
          ? `You have more than one upcoming assignment. Please send the job reference and a screenshot of that text, and don't set off until it's confirmed.`
          : `Thanks — I've matched this to ${refList}. Here's what the record supports; I won't describe anything as done until it is.`,
      sendable: true,
    },
    {
      id: "resolve-link",
      title: impostor ? "Record: no order link (unverified claim)" : ambiguous ? "Record: identity needed before linking" : `Record the link to ${refList || "the order"}`,
      whatChanges: "Nothing is written to the snapshot. Approving records the link decision in this control room.",
      draft: impostor ? "No order is linked. The reference is an unverified claim." : ambiguous ? "No order is linked until the driver sends a reference." : `Linked to ${refList}.`,
      sendable: false,
    },
    {
      id: "escalate",
      title: "Hand to a person with the context",
      whatChanges: "Nothing is written. Approving records that a person will pick this up, with the thread and basis attached.",
      draft: "Escalate with the thread, the link basis and what is still missing.",
      sendable: false,
    },
  ]

  return {
    threadId: thread.id, category, categoryLabel: label(category), channel, linkState, linkStateLabel: label(linkState),
    waitingOn, basis, candidates, linked, tone: toneFor(linkState),
    card: { kind: "driver_support", kicker: "Support inbox", orderId: linked[0]?.id ?? candidates[0]?.id ?? "", headline, summary, missing, facts, alreadyDone: [], actions, source: "records" },
  }
}

export async function loadSupportCases(): Promise<SupportCase[]> {
  const [threadRows, messageRows] = await Promise.all([
    db.select({ id: relatedRecords.id, details: relatedRecords.details }).from(relatedRecords).where(eq(relatedRecords.collection, "support_inbox_threads")),
    db.select({ id: relatedRecords.id, details: relatedRecords.details }).from(relatedRecords).where(eq(relatedRecords.collection, "support_inbox_messages")),
  ])
  const open = threadRows.filter((t) => str(t.details.status) === "OPEN")
  const refIds = open.flatMap((t) => [
    ...(Array.isArray(t.details.candidate_order_ids) ? t.details.candidate_order_ids : []),
    ...(Array.isArray(t.details.linked_order_ids) ? t.details.linked_order_ids : []),
  ]).filter((x): x is string => typeof x === "string")
  const refs = new Map((await orderRefs(refIds)).map((r) => [r.id, r.reference]))

  const byThread = new Map<string, Msg[]>()
  for (const m of messageRows) {
    const threadId = str(m.details.thread_id)
    if (!threadId) continue
    const list = byThread.get(threadId) ?? []
    list.push({ id: m.id, author: label(str(m.details.author_type) ?? "sender"), at: str(m.details.authored_at) ?? str(m.details.created_at), body: str(m.details.body) ?? "" })
    byThread.set(threadId, list)
  }
  for (const list of byThread.values()) list.sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")))

  const order = { PENDING_IDENTITY: 0, PENDING_MATCH: 1 } as Record<string, number>
  return open
    .map((t) => buildCard({ id: t.id, details: t.details }, byThread.get(t.id) ?? [], refs))
    .sort((a, b) => (order[a.linkState] ?? 2) - (order[b.linkState] ?? 2))
}

export async function loadSupportThread(threadId: string): Promise<SupportCase | null> {
  const cases = await loadSupportCases()
  return cases.find((c) => c.threadId === threadId) ?? null
}

// --- agent ----------------------------------------------------------------

const SYSTEM = `You are the Driver Support agent for a car delivery desk. One support-inbox thread is open and a person is waiting.

Use the tools to read the thread and its link basis, then call submit_decision once.

Rules:
- If the reference belongs to another account (an unverified claim, not a link), reveal nothing — no car, route, buyer or driver detail. Ask the sender to confirm the reference on their own booking.
- If the message cannot be matched to one job, ask for the job reference. Do not guess a job.
- Answer only what the record supports. Never say a document is signed or ready, or that a payout is made, unless the record confirms it.
- reply is the message to send. Keep it to what the rules allow.
- Cite only what you read.`

function spec(support: SupportCase, note?: string, history?: AgentTurn[]) {
  const base = support.card
  const safeThread = {
    category: support.category, channel: support.channel, linkState: support.linkState, waitingOn: support.waitingOn,
    basis: support.basis, candidates: support.candidates.map((c) => c.reference), linked: support.linked.map((c) => c.reference),
    messages: support.card.facts.filter((f) => f.kind === "inbox").map((f) => ({ id: f.recordId, text: f.text })),
  }
  const tools = [
    fn("read_thread", "The thread's messages, its link basis, link state and what it is waiting on.", EMPTY_PARAMETERS),
    fn("submit_decision", "Submit the reading and the reply. Call once, after reading.", {
      type: "object",
      properties: {
        summary: { type: "string", description: "Two or three sentences: what is asked, whether it can be linked, and what is safe to say." },
        reply: { type: "string", description: "The message to send. For an unverified reference, reveal nothing and ask for a verified reference." },
        linkDecision: { type: "string", description: "Link one order, needs identity, or no order (unverified claim)." },
        escalate: { type: "string", description: "What a person should pick up, if anything, with the context." },
        say: { type: "string", description: "One or two sentences back to the person at the desk. Not the message to the sender. Never offer to contact a customer." },
      },
      required: ["summary", "reply", "linkDecision", "escalate"],
    }),
  ]
  return {
    system: SYSTEM,
    task: `Support thread ${support.threadId} (${support.linkStateLabel}). Read it, then submit_decision. Do not answer in prose.`,
    tools,
    readTools: ["read_thread"] as const,
    submitTool: "submit_decision",
    knownIds: support.card.facts.map((f) => f.recordId),
    toolPayload: (name: string): unknown => (name === "read_thread" ? safeThread : { error: "Unknown tool" }),
    base,
    note,
    history,
    validate(input: Record<string, unknown>): string | null {
      return supportReplyProblem(textOf(input.reply), support.linkState)
    },
    finalize(input: Record<string, unknown>): { card: RoomCard; refusedDraft: string | null } {
      const replyProblem = supportReplyProblem(textOf(input.reply), support.linkState)
      const reply = replyProblem ? undefined : textOf(input.reply).trim()
      const summary = textOf(input.summary).trim()
      const card: RoomCard = {
        ...base,
        source: reply || summary ? "agent" : "records",
        summary: summary && summary.length > 20 ? summary : base.summary,
        actions: base.actions.map((a) => a.id === "answer" && reply ? { ...a, draft: reply } : a),
      }
      return { card, refusedDraft: replyProblem ? textOf(input.reply).trim() || null : null }
    },
  }
}

export async function investigateSupport(support: SupportCase, note?: string, history?: AgentTurn[]): Promise<Investigation> {
  if (support.linkState === "PENDING_IDENTITY") {
    return {
      ok: false,
      error: "Agent stopped. The sender is not verified, so the model was not shown another account's car, route, or driver.",
      card: support.card,
      trace: [{ tool: "stop", summary: "Unverified sender. The model was not called." }],
      refusedDraft: null,
    }
  }
  return runAgent(spec(support, note, history))
}
