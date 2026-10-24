// Room decisions and the latest agent look, in the same shape as a recorded proposal
// so the order page can show them beside the snapshot's own agent work.

import type { Actor, ProposalView } from "@/lib/present/types"
import type { Investigation, SessionDecision } from "./types"

const operator: Actor = { id: null, kind: "operator", name: "Operator", role: "operator" }
const agent: Actor = { id: "on-the-road", kind: "agent", name: "On the road", role: "agent" }

const TITLES: Record<string, string> = {
  "ask-driver": "Ask the driver for the place and the photo",
  "hold-promise": "Leave the delivery promise as recorded",
  "owner-call": "Call the customer. Do not send a message",
  "reply-driver": "Tell the driver where the crossing stands",
  "propose-rebook": "Propose a crossing booking for approval",
}

function titleFor(actionId: string): string {
  return TITLES[actionId] ?? actionId.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

function choiceLabel(choice: SessionDecision["choice"]): string {
  if (choice === "rejected") return "Rejected"
  if (choice === "edited") return "Edited, then approved"
  return "Approved"
}

export function roomProposalViews(decisions: SessionDecision[], investigation: Investigation | null): ProposalView[] {
  const views: ProposalView[] = []
  if (investigation) {
    views.push({
      id: `investigation:${investigation.card.orderId}`,
      status: investigation.ok ? "LOOKED" : "NOT_RUN",
      statusLabel: investigation.ok ? "Looked" : "Not run",
      tone: investigation.ok ? "accent" : "neutral",
      command: "on_the_road.look",
      commandLabel: "Look up the stop",
      summary: investigation.ok ? "On the road agent looked up the stop" : "On the road agent was asked to look, and did not run",
      rationale: investigation.error ?? investigation.card.summary,
      agent,
      createdAt: investigation.lookedAt ?? decisions[0]?.at ?? "",
      alertId: null,
      evidenceCount: investigation.trace.length,
      dependency: investigation.trace.map((step) => step.tool).join(", ") || "No tools called",
      review: null,
      execution: { status: "NOT_SENT", statusLabel: "Nothing sent", at: null, error: investigation.refusedDraft ? `Refused draft: ${investigation.refusedDraft}` : null, effects: 0 },
      superseded: null,
    })
  }
  for (const decision of decisions) {
    const rejected = decision.choice === "rejected"
    views.push({
      id: `decision:${decision.orderId}:${decision.actionId}`,
      status: rejected ? "REJECTED" : "APPROVED",
      statusLabel: choiceLabel(decision.choice),
      tone: rejected ? "warn" : "ok",
      command: decision.actionId,
      commandLabel: titleFor(decision.actionId),
      summary: `${titleFor(decision.actionId)}. ${rejected ? "The case stays open." : "Nothing was sent and the snapshot was not changed."}`,
      rationale: decision.text,
      agent,
      createdAt: decision.at,
      alertId: null,
      evidenceCount: 0,
      dependency: "Recorded in this control room",
      review: { decision: decision.choice, decisionLabel: choiceLabel(decision.choice), note: decision.text, reviewer: operator, at: decision.at },
      execution: { status: "NOT_SENT", statusLabel: "Nothing sent", at: decision.at, error: null, effects: 0 },
      superseded: null,
    })
  }
  return views
}
