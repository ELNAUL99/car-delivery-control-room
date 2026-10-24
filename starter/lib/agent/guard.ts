// The approval seam. A driver draft that clears the car to move, or that asks the
// owner a question, is refused before anyone can approve it.

export function driverDraftProblem(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length < 20) return "The message is too short to send."
  const lower = trimmed.toLowerCase()
  if (!/\bstopped\b/.test(lower)) return "The message has to tell the driver the car stays stopped."
  const stripped = lower
    .replace(/do not restart/g, "")
    .replace(/don't restart/g, "")
    .replace(/do not drive/g, "")
    .replace(/don't drive/g, "")
  if (/\brestart\b/.test(stripped)) return "The message must not tell the driver to restart the car."
  if (/\bdrive\b/.test(stripped)) return "The message must not clear the car to drive."
  if (/\b(book|rebook|tow|flatbed)\b/.test(lower)) return "The message must not book recovery."
  if (/\b(eta|arrival time|delivery time|delivery promise)\b/.test(lower)) return "The message must not state a delivery time."
  if (/\b(roadside|collection|customer)\b/.test(lower)) return "Ask the driver only for the place and the photo. The owner's choice is a separate call."
  return null
}

export function summaryProblem(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length < 40) return "The reading is too short."
  const lower = trimmed.toLowerCase()
  if (/notified the customer|emailed the customer|customer notified|booked roadside|dispatched a driver|backup driver/.test(lower)) {
    return "The reading claims a customer was told something new, or that recovery was booked."
  }
  const stripped = lower.replace(/do not restart/g, "").replace(/removed the restart/g, "").replace(/without a restart/g, "").replace(/no restart/g, "")
  if (/\brestart\b/.test(stripped)) return "The reading tells someone to restart the car."
  return null
}
