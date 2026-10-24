// The registry of deep areas. Adding an area is adding one CaseKind here.
// The queue, the agent routes and the decide route all dispatch through this.

import { investigateOrder } from "@/lib/agent/investigate"
import { driverDraftProblem } from "@/lib/agent/guard"
import type { Bundle } from "@/lib/present/bundle"
import { buildOnTheRoadCard, isOpenVehicleWarning, roadHalt } from "./on-the-road"
import { driverTravelKind } from "./travel"
import { pickupReadinessKind } from "./pickup"
import { promiseGuardianKind } from "./promise"
import type { CaseKind, CaseKindId } from "./types"

// On the Road keeps its own, already-proven loop; it just presents as a CaseKind.
const onTheRoadKind: CaseKind = {
  id: "on_the_road",
  kicker: "Vehicle warning",
  label: "On the Road",
  priority: 10,
  detect: isOpenVehicleWarning,
  buildCard: buildOnTheRoadCard,
  investigate: investigateOrder,
  halt: roadHalt,
  actionIds: ["ask-driver", "hold-promise", "owner-call"],
  guardAction(actionId, text) {
    return actionId === "ask-driver" ? driverDraftProblem(text ?? "") : null
  },
}

// Lowest priority wins when several areas match one order.
export const CASE_KINDS: CaseKind[] = [onTheRoadKind, driverTravelKind, pickupReadinessKind, promiseGuardianKind].sort((a, b) => a.priority - b.priority)

export function kindFor(bundle: Bundle): CaseKind | null {
  return CASE_KINDS.find((kind) => kind.detect(bundle)) ?? null
}

export function kindById(id: string): CaseKind | null {
  return CASE_KINDS.find((kind) => kind.id === (id as CaseKindId)) ?? null
}
