// One tool loop for an open vehicle warning. The model may rewrite the driver
// draft and the short reading. It cannot replace the cited facts, and a draft
// that would move the car is refused before it can be approved.

import { driverDraftProblem } from "@/lib/agent/guard"
import { followUp, spokenReply } from "@/lib/agent/talk"
import { applyAgentDrafts, buildOnTheRoadCard, knownRecordIds, roadSlices } from "@/lib/room/on-the-road"
import type { AgentTrace, AgentTurn, Investigation } from "@/lib/room/types"
import type { Bundle } from "@/lib/present/bundle"

type ToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: unknown } }
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; name: string; tool_call_id: string; content: string }

const READS = ["read_messages", "read_incident", "read_alerts_and_tracking", "read_prior_proposal"] as const

const SYSTEM = `You are the On-the-Road agent for a car delivery desk. A person is waiting on one decision about a stopped car.

Use the tools. They return records from a frozen snapshot. Then call submit_decision once.

Rules:
- Do not diagnose the warning light.
- Do not clear the car to drive, suggest a restart, book recovery, dispatch another driver, or write a new delivery time.
- Do not contact the customer. callScript is words the person may say on the phone. It is not an email.
- driverDraft is a message to the driver. Ask only for the service-area name or a pin, and a photo of the dashboard. The car stays stopped, engine off. Say that nobody has cleared it to drive.
- Cite nothing you did not read. Do not invent a place, a price, a workshop, or a backup driver.
- Do not state a clock time. Say "the customer's delivery promise" and "the last driver-app position".
- The case stays open until a verified place, the photo, and the owner's roadside-or-collection choice exist.`

const EMPTY_PARAMETERS = { type: "object", properties: {} }

const TOOLS = [
  fn("read_messages", "Every message on this order, oldest first, with author, channel and record id.", EMPTY_PARAMETERS),
  fn("read_incident", "The open vehicle-warning incident, the open work item, and requested documents.", EMPTY_PARAMETERS),
  fn("read_alerts_and_tracking", "Alerts, the latest driver-app tracking observation, and the customer delivery promise.", EMPTY_PARAMETERS),
  fn("read_prior_proposal", "The earlier agent proposal, including the text a person edited before it was sent.", EMPTY_PARAMETERS),
  fn("submit_decision", "Submit the reading and the drafts. Call this once, after the reads.", {
    type: "object",
    properties: {
      summary: { type: "string", description: "Two or three sentences. What is known, what is missing, and that the car is not cleared to drive." },
      driverDraft: { type: "string", description: "Exact driver-chat text. Place and dashboard photo only. Car stays stopped." },
      callScript: { type: "string", description: "What the person can say to the customer on a call. Not an email." },
      promiseNote: { type: "string", description: "Why the delivery promise stays as recorded. No new time." },
      say: { type: "string", description: "One or two sentences back to the person at the desk. If they asked you to contact a customer, refuse. If they asked you to reach the driver, say the draft waits for their approval." },
    },
    required: ["summary", "driverDraft", "callScript", "promiseNote"],
  }),
]

function fn(name: string, description: string, parameters: Record<string, unknown>) {
  return { type: "function", function: { name, description, parameters } }
}

function toolPayload(name: string, slices: NonNullable<ReturnType<typeof roadSlices>>): unknown {
  if (name === "read_messages") return { messages: slices.messages }
  if (name === "read_incident") return { incident: slices.incident, work: slices.work, documents: slices.documents, vehicle: slices.vehicle, driver: slices.driver, customer: slices.customer, reference: slices.reference, origin: slices.origin, destination: slices.destination }
  if (name === "read_alerts_and_tracking") return { alerts: slices.alerts, tracking: slices.tracking, promise: slices.promise, snapshotAt: slices.snapshotAt }
  if (name === "read_prior_proposal") return { proposal: slices.proposal }
  return { error: "Unknown tool" }
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export async function investigateOrder(bundle: Bundle, note?: string, history?: AgentTurn[]): Promise<Investigation> {
  const base = buildOnTheRoadCard(bundle)
  const slices = roadSlices(bundle)
  if (!base || !slices) {
    throw new Error("This agent only handles an open vehicle warning.")
  }
  const trace: AgentTrace[] = []
  const apiKey = process.env.MISTRAL_API_KEY?.trim()
  if (!apiKey) {
    return {
      ok: false,
      error: "No MISTRAL_API_KEY is set. The card is the reading of the records.",
      card: base,
      trace,
      refusedDraft: null,
    }
  }
  const model = process.env.MISTRAL_MODEL?.trim() || "ministral-8b-2512"
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: followUp(`Order ${slices.orderId} (${slices.reference}). Look it up with the tools, then submit_decision. Do not answer in prose.`, note, history) },
  ]
  let refusedDraft: string | null = null
  let rewrites = 0

  for (let round = 0; round < 6; round += 1) {
    const message = await callModel(apiKey, model, messages)
    const calls = message.tool_calls ?? []
    messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls.length > 0 ? calls : undefined })
    if (calls.length === 0) {
      trace.push({ tool: "stop", summary: "The agent stopped without a decision. The card stays the record reading." })
      return { ok: false, error: "The agent stopped without a decision. The card is the reading of the records.", card: base, trace, refusedDraft }
    }
    let finished: Investigation | null = null
    calls.forEach((call, index) => {
      const name = call.function?.name ?? "tool"
      const callId = call.id || `call-${round}-${index}`
      const reply = (content: unknown) => {
        messages.push({ role: "tool", name, tool_call_id: callId, content: JSON.stringify(content) })
      }
      if (name === "submit_decision") {
        const input = argsOf(call.function?.arguments)
        const problem = driverDraftProblem(textOf(input.driverDraft))
        if (problem && rewrites < 1) {
          rewrites += 1
          refusedDraft = textOf(input.driverDraft).trim() || null
          trace.push({ tool: "submit_decision", summary: `Draft refused: ${problem}` })
          reply({ error: problem, instruction: "Rewrite driverDraft. Ask only for the place and the photo. The car stays stopped. Do not mention roadside, collection, or a delivery time." })
          return
        }
        const applied = applyAgentDrafts(base, slices, {
          summary: textOf(input.summary),
          driverDraft: textOf(input.driverDraft),
          callScript: textOf(input.callScript),
          promiseNote: textOf(input.promiseNote),
        })
        if (applied.refusedDraft) refusedDraft = applied.refusedDraft
        trace.push({ tool: "submit_decision", summary: applied.card.source === "agent" ? "Decision accepted. Cited facts stayed on the card." : "Decision kept the record reading." })
        finished = { ok: applied.card.source === "agent" || !problem, error: problem && applied.card.source !== "agent" ? problem : null, card: applied.card, trace, refusedDraft, reply: note ? spokenReply(note, input.say) : null }
        reply({ accepted: true })
        return
      }
      if (!READS.includes(name as (typeof READS)[number])) {
        reply({ error: "Unknown tool" })
        return
      }
      const payload = toolPayload(name, slices)
      const ids = [...knownRecordIds(slices)]
      trace.push({ tool: name, summary: `${countOf(payload)} records. Ids include ${ids.slice(0, 4).join(", ")}.` })
      reply(payload)
    })
    if (finished) return finished
  }
  trace.push({ tool: "stop", summary: "The agent used its turns without a usable decision." })
  return { ok: false, error: "The agent did not finish. The card is the reading of the records.", card: base, trace, refusedDraft }
}

function countOf(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0
  const record = payload as Record<string, unknown>
  return Object.values(record).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : value ? 1 : 0), 0)
}

function argsOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== "string" || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function callModel(apiKey: string, model: string, messages: ChatMessage[]): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, max_tokens: 2000, messages, tools: TOOLS, tool_choice: "auto" }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`The model call failed (${response.status}). ${detail.slice(0, 180)}`)
  }
  const body = await response.json() as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] }
  const message = body.choices?.[0]?.message
  return { content: message?.content ?? null, tool_calls: message?.tool_calls }
}
