// How a person and the agent talk. The agent may draft a message for a driver
// or a pickup place. It never contacts a customer. The reply is what the person
// reads in the thread.

import type { AgentTurn, Investigation } from "@/lib/room/types"

const CUSTOMER = /\b(customer|owner|buyer)\b/i
const REACH = /\b(call|email|e-mail|message|contact|tell|notify|text|write|ping|reach)\b/i
const HOLD_BACK = /\b(do not|don't|never|must not|without)\b/i
const CLAIMS_SENT = /i (have |just )?(emailed|contacted|called|messaged|notified|told) the (customer|owner|buyer)/i

export function personWantsCustomerContact(note: string): boolean {
  return CUSTOMER.test(note) && REACH.test(note) && !HOLD_BACK.test(note)
}

/** The sentence shown as the agent's side of the thread. */
export function spokenReply(note: string, modelReply: unknown): string {
  if (personWantsCustomerContact(note)) {
    return "I will not contact the customer. That call stays with you, and the words for it are on the card. I can draft a message for the driver or the pickup place, and it counts only after you approve it."
  }
  const text = typeof modelReply === "string" ? modelReply.trim() : ""
  if (text && !CLAIMS_SENT.test(text)) return text.slice(0, 420)
  return "I updated the drafts below. A message for the driver or the pickup place waits for your approval. I will not contact the customer."
}

export function followUp(task: string, note: string | undefined, history: AgentTurn[] | undefined): string {
  if (!note) return task
  const earlier = (history ?? []).filter((turn) => turn.text).slice(-6)
    .map((turn) => `Person: ${turn.text}${turn.reply ? `\nAgent: ${turn.reply}` : ""}`)
  const past = earlier.length ? `Earlier in this conversation:\n${earlier.join("\n")}\n\n` : ""
  const base = task.replace(/Do not answer in prose\.?/g, "Answer the person only in the say field.")
  return `${base}\n\n${past}The person asks: ${note}
Use the tools, then submit_decision. Put your answer to the person in say: one or two sentences.
You may prepare a message for the driver or the pickup place. They approve it before it counts as sent.
You never contact a customer. If they ask you to, say the call stays with them.`
}

export function withTurn(result: Investigation, previous: Investigation | null, note: string): Investigation {
  const turns = previous?.turns ?? []
  if (!note) return { ...result, turns }
  const reply = result.reply?.trim()
    || (result.error?.startsWith("Agent stopped") ? result.error : spokenReply(note, null))
  return { ...result, turns: [...turns, { at: new Date().toISOString(), text: note, reply }] }
}
