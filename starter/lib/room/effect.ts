// What happens after a person decides. A customer is never contacted from here.
// An approved driver or pickup message is the message for them. The snapshot
// is never changed.

const CUSTOMER_ACTIONS = new Set(["owner-call", "customer-reconcile", "customer-call"])
const PROPOSE = new Set(["propose-rebook", "propose-revised"])

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function effectFor(actionId: string, choice: "approved" | "rejected" | "edited"): string {
  const t = stamp()
  if (choice === "rejected") return `${t} — Rejected. The case stays open. Nothing was sent.`
  if (CUSTOMER_ACTIONS.has(actionId)) return `${t} — Recorded that you will contact the customer yourself. No message was sent to the customer.`
  if (actionId === "ask-driver" || actionId === "reply-driver") return `${t} — Approved for the driver. This is the message to them. No customer was contacted, and the snapshot is unchanged.`
  if (actionId === "ask-site") return `${t} — Approved for the pickup place. This is the message to them. No customer was contacted, and the snapshot is unchanged.`
  if (actionId === "answer") return `${t} — Approved as the reply on this thread. No customer was contacted, and the snapshot is unchanged.`
  if (PROPOSE.has(actionId)) return `${t} — Recorded for action. No booking was made, and no customer was contacted.`
  if (actionId === "escalate") return `${t} — Handed to a person with the thread and the context. No customer contacted.`
  return `${t} — Recorded. Nothing was written to the order, and no customer was contacted.`
}
