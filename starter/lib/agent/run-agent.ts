// A generic tool-use loop shared by the deep areas (On the Road keeps its own).
// Reads come from a frozen snapshot. The model may rewrite drafts and the short
// reading; it cannot replace the cited facts. A draft that breaks an area's rule
// is refused once before the model may try again.

import type { AgentToolDef, AgentTrace, AgentTurn, Investigation, RoomCard } from "@/lib/room/types"
import { followUp, spokenReply } from "./talk"

type ToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: unknown } }
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; name: string; tool_call_id: string; content: string }

export type AgentSpec = {
  /** System prompt — the area's rules. */
  system: string
  /** First user turn. */
  task: string
  /** Read + submit tool definitions. */
  tools: AgentToolDef[]
  /** Names of the read tools (everything that is not the submit tool). */
  readTools: readonly string[]
  /** The submit tool's name. */
  submitTool: string
  /** Record ids the reads expose, for the trace line. */
  knownIds: string[]
  /** Payload a read tool returns. */
  toolPayload(name: string): unknown
  /** A problem with the submitted drafts, or null. Non-null triggers one rewrite. */
  validate(input: Record<string, unknown>): string | null
  /** Build the final card from the accepted submit input. */
  finalize(input: Record<string, unknown>): { card: RoomCard; refusedDraft: string | null }
  /** The records-only card, used as the fallback and the base. */
  base: RoomCard
  /** A follow-up the person typed. */
  note?: string
  /** Earlier turns, so the next reply continues the same conversation. */
  history?: AgentTurn[]
}

export async function runAgent(spec: AgentSpec): Promise<Investigation> {
  const trace: AgentTrace[] = []
  const apiKey = process.env.MISTRAL_API_KEY?.trim()
  if (!apiKey) {
    return { ok: false, error: "No MISTRAL_API_KEY is set. The card is the reading of the records.", card: spec.base, trace, refusedDraft: null }
  }
  const model = process.env.MISTRAL_MODEL?.trim() || "ministral-8b-2512"
  const messages: ChatMessage[] = [
    { role: "system", content: spec.system },
    { role: "user", content: followUp(spec.task, spec.note, spec.history) },
  ]
  let refusedDraft: string | null = null
  let rewrites = 0

  for (let round = 0; round < 6; round += 1) {
    const message = await callModel(apiKey, model, messages, spec.tools)
    const calls = message.tool_calls ?? []
    messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls.length > 0 ? calls : undefined })
    if (calls.length === 0) {
      trace.push({ tool: "stop", summary: "The agent stopped without a decision. The card stays the record reading." })
      return { ok: false, error: "The agent stopped without a decision. The card is the reading of the records.", card: spec.base, trace, refusedDraft }
    }
    let finished: Investigation | null = null
    calls.forEach((call, index) => {
      const name = call.function?.name ?? "tool"
      const callId = call.id || `call-${round}-${index}`
      const reply = (content: unknown) => messages.push({ role: "tool", name, tool_call_id: callId, content: JSON.stringify(content) })
      if (name === spec.submitTool) {
        const input = argsOf(call.function?.arguments)
        const problem = spec.validate(input)
        if (problem && rewrites < 1) {
          rewrites += 1
          refusedDraft = firstDraft(input)
          trace.push({ tool: name, summary: `Draft refused: ${problem}` })
          reply({ error: problem, instruction: "Fix the draft and submit again. Keep to the rule in the error." })
          return
        }
        const applied = spec.finalize(input)
        if (applied.refusedDraft) refusedDraft = applied.refusedDraft
        trace.push({ tool: name, summary: applied.card.source === "agent" ? "Decision accepted. Cited facts stayed on the card." : "Decision kept the record reading." })
        finished = { ok: applied.card.source === "agent" || !problem, error: problem && applied.card.source !== "agent" ? problem : null, card: applied.card, trace, refusedDraft, reply: spec.note ? spokenReply(spec.note, input.say) : null }
        reply({ accepted: true })
        return
      }
      if (!spec.readTools.includes(name)) {
        reply({ error: "Unknown tool" })
        return
      }
      const payload = spec.toolPayload(name)
      trace.push({ tool: name, summary: `${countOf(payload)} records. Ids include ${spec.knownIds.slice(0, 4).join(", ")}.` })
      reply(payload)
    })
    if (finished) return finished
  }
  trace.push({ tool: "stop", summary: "The agent used its turns without a usable decision." })
  return { ok: false, error: "The agent did not finish. The card is the reading of the records.", card: spec.base, trace, refusedDraft }
}

function firstDraft(input: Record<string, unknown>): string | null {
  for (const key of ["driverDraft", "message", "reply", "note", "draft"]) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function countOf(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0
  return Object.values(payload as Record<string, unknown>).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : value ? 1 : 0), 0)
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

async function callModel(apiKey: string, model: string, messages: ChatMessage[], tools: AgentToolDef[]): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 2000, messages, tools, tool_choice: "auto" }),
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

export function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function fn(name: string, description: string, parameters: Record<string, unknown>): AgentToolDef {
  return { type: "function", function: { name, description, parameters } }
}

export const EMPTY_PARAMETERS = { type: "object", properties: {} }
