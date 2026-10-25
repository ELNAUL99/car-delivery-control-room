// =============================================================================
// phone-live.ts — LIVE TELEPHONY BLUEPRINT (inert reference, not wired in)
// =============================================================================
//
// Everything below is COMMENTED ON PURPOSE. This file compiles to nothing (the
// only real statement is the `export {}` at the very bottom, which just makes it
// a valid empty ES module under tsconfig's `isolatedModules`). It changes no
// runtime behaviour: the app still runs the deterministic mock in
// `lib/agent/phone.ts`. This file is the "last step" made concrete — the real
// Twilio integration written out so that activating it is: install the SDK,
// paste these into real files, and add credentials + a from-number.
//
// WHY A MOCK TODAY, AND WHAT STAYS REAL
// -------------------------------------
// The mock's VALUE is not the fake dialogue — it is the readiness LOGIC:
//   * which questions to ask (exact VIN in the release queue? keys? signed,
//     vehicle-specific release? bay assigned? staff to authorise?),
//   * the hard rule that a "similar stock reference" is NEVER a VIN match, and
//   * the outcome/checklist shape the UI renders (`PickupCall` in
//     lib/room/types.ts).
// The live path below REUSES all of that. Only the transport changes: instead of
// scripting the branch's answers, a real call collects them. The UI contract
// (`PickupCall { site, reference, attempts, reached, ready, transcript,
// checklist, outcome }`) is kept identical so the room renders it unchanged.
//
// THE ONE ARCHITECTURAL DIFFERENCE TO KNOW (say this in the pitch)
// ----------------------------------------------------------------
// The mock returns the whole transcript synchronously from POST /call. A REAL
// call cannot: it rings, a human answers, it runs for ~60-120s, and Twilio
// reports progress via webhooks. So the live design is asynchronous:
//   1. POST /call  -> kicks off the call, returns { status:"dialing", callId }.
//   2. Twilio hits our webhooks during the call; we persist transcript lines
//      and gathered answers to a `pickup_calls` row keyed by callId.
//   3. The room polls GET /call/:callId (or subscribes) and, once status is
//      "completed", renders the SAME PickupCall object assembled from the row.
// The current mock is effectively step 1+assemble collapsed into one response.
//
// =============================================================================
// 0) INSTALL + ENVIRONMENT  (see also the commented block in .env.example)
// =============================================================================
//
//   npm i twilio
//
//   # Twilio Programmable Voice (Mode A, scripted IVR)
//   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   CALL_CENTER_FROM=+358XXXXXXXXX        # the company/call-centre number (E.164)
//   PUBLIC_BASE_URL=https://your-app.example.com  # must be publicly reachable by Twilio
//
//   # Mode B only (conversational voice agent) — pick ONE managed provider, or
//   # self-host media-streams + STT/TTS. Managed is the fast path to a pilot.
//   VOICE_PROVIDER=vapi        # vapi | bland | retell | self   (unset => Mode A)
//   VAPI_API_KEY=...           # (or BLAND_API_KEY / RETELL_API_KEY)
//
// LIVE is OFF unless the Twilio trio is present, so the repo keeps running the
// mock with no config. The selector in §1 enforces that.
//
// DATA GAP TO CLOSE (be honest about this): the snapshot's `places` rows don't
// reliably carry a dialable branch phone. Live mode needs `place.details.phone`
// in E.164, or a lookup table site_id -> phone. Until that exists, `resolveBranchNumber`
// returns null and we fall back to the mock. This is a data task, not a code one.
//
// =============================================================================
// 1) PROVIDER SEAM + SELECTOR  -> lib/agent/telephony.ts
// =============================================================================
//
// import type { PickupCall } from "@/lib/room/types"
// import type { PickupCtx } from "@/lib/agent/phone"
//
// export type StartedCall = { callId: string; status: "dialing" | "mock"; mock?: PickupCall }
//
// export interface CallProvider {
//   // Begins a call and returns immediately. The transcript/outcome arrive later
//   // via webhooks and are assembled into a PickupCall keyed by callId.
//   startPickupCall(ctx: PickupCtx, branchNumber: string): Promise<StartedCall>
// }
//
// export function liveTelephonyEnabled(): boolean {
//   return Boolean(
//     process.env.TWILIO_ACCOUNT_SID &&
//     process.env.TWILIO_AUTH_TOKEN &&
//     process.env.CALL_CENTER_FROM &&
//     process.env.PUBLIC_BASE_URL,
//   )
// }
//
// // Resolve the branch's dialable number from the place record (see DATA GAP).
// // Must return E.164 (+countrycode...). Returns null when we can't dial safely.
// export function resolveBranchNumber(placeDetails: Record<string, unknown>): string | null {
//   const raw = typeof placeDetails.phone === "string" ? placeDetails.phone : null
//   if (!raw) return null
//   const e164 = raw.replace(/[^\d+]/g, "")
//   return /^\+\d{8,15}$/.test(e164) ? e164 : null
// }
//
// export function pickProvider(): CallProvider {
//   const mode = (process.env.VOICE_PROVIDER ?? "").toLowerCase()
//   if (mode === "vapi" || mode === "bland" || mode === "retell") return conversationalProvider(mode) // §3
//   return twilioScriptedProvider() // §2 (default live path)
// }
//
// =============================================================================
// 2) MODE A — TWILIO PROGRAMMABLE VOICE (scripted IVR, deterministic)
// =============================================================================
// This is the realistic "add credentials + a number" step. Twilio places the
// call, plays TTS prompts, and GATHERS the branch's answers as speech or keypad
// digits for a short, fixed set of yes/no confirmations. It does NOT freely
// converse (that's Mode B) — but it genuinely dials a human and records the
// verified result, which is enough to move collection off "simulated".
//
// ---- 2a) The provider: start the call  -> lib/agent/telephony-twilio.ts -------
//
// import twilio from "twilio"
// import type { CallProvider, StartedCall } from "@/lib/agent/telephony"
// import type { PickupCtx } from "@/lib/agent/phone"
// import { createPickupCallRow } from "@/lib/agent/call-store" // §2d
//
// export function twilioScriptedProvider(): CallProvider {
//   const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
//   return {
//     async startPickupCall(ctx: PickupCtx, branchNumber: string): Promise<StartedCall> {
//       // Persist a row FIRST so webhooks have somewhere to write, even if they
//       // arrive before client.calls.create() resolves.
//       const callId = await createPickupCallRow(ctx)
//       const base = process.env.PUBLIC_BASE_URL!
//       const call = await client.calls.create({
//         to: branchNumber,
//         from: process.env.CALL_CENTER_FROM!,
//         // TwiML the moment the branch answers:
//         url: `${base}/api/voice/pickup/twiml?callId=${encodeURIComponent(callId)}`,
//         method: "POST",
//         // Lifecycle (ring/answer/no-answer/busy/completed) -> §2c:
//         statusCallback: `${base}/api/voice/pickup/status?callId=${encodeURIComponent(callId)}`,
//         statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
//         statusCallbackMethod: "POST",
//         machineDetection: "DetectMessageEnd", // if voicemail, we hang up & retry
//         timeout: 30, // ring 30s then no-answer -> retry handled in §2c
//       })
//       await linkCallSid(callId, call.sid) // §2d
//       return { callId, status: "dialing" }
//     },
//   }
// }
//
// ---- 2b) The TwiML webhook (drives the conversation) --------------------------
//        -> app/api/voice/pickup/twiml/route.ts
//
// Twilio POSTs here when the branch answers. We return TwiML: speak a prompt,
// then <Gather> the answer (speech + DTMF: 1 = yes, 2 = no), posting each answer
// to /answer with a step marker. We walk the SAME checklist the mock uses.
//
// import { NextResponse } from "next/server"
// import { twiml as TwiML } from "twilio"
// import { getPickupCallRow, appendTranscript } from "@/lib/agent/call-store"
// import { verifyTwilioSignature } from "@/lib/agent/twilio-verify" // §5
//
// export const runtime = "nodejs"
//
// export async function POST(req: Request) {
//   if (!(await verifyTwilioSignature(req))) return new NextResponse("forbidden", { status: 403 })
//   const url = new URL(req.url)
//   const callId = url.searchParams.get("callId")!
//   const step = url.searchParams.get("step") ?? "vin"
//   const row = await getPickupCallRow(callId)
//   const vr = new TwiML.VoiceResponse()
//   const base = process.env.PUBLIC_BASE_URL!
//
//   // Fixed question script, mirroring runPickupCall()'s checklist order.
//   const prompts: Record<string, string> = {
//     vin: `This is Bahn operations about collection ${row.reference}, a ${row.vehicle}. ` +
//          `Please confirm: is the exact V I N ${spellVin(row.vin)} in your release queue today? ` +
//          `Press 1 for yes, 2 for no, or say yes or no after the tone.`,
//     keys: `Are the keys and a signed, vehicle-specific release ready for that exact V I N? Press 1 for yes, 2 for no.`,
//     bay:  `Is a collection bay assigned for our driver? Press 1 for yes, 2 for no.`,
//   }
//   appendTranscript(callId, { who: "agent", text: prompts[step] })
//   const gather = vr.gather({
//     input: ["speech", "dtmf"], numDigits: 1, timeout: 6, speechTimeout: "auto",
//     action: `${base}/api/voice/pickup/answer?callId=${callId}&step=${step}`,
//     method: "POST",
//   })
//   gather.say({ voice: "Polly.Marlene" }, prompts[step])
//   // No input -> repeat once, else bail to status/hangup.
//   vr.redirect(`${base}/api/voice/pickup/twiml?callId=${callId}&step=${step}`)
//   return new NextResponse(vr.toString(), { headers: { "content-type": "text/xml" } })
// }
//
// function spellVin(vin: string | null): string { return (vin ?? "the recorded V I N").split("").join(" ") }
//
// ---- 2c) The answer + status webhooks (collect results, retry, finish) --------
//        -> app/api/voice/pickup/answer/route.ts  and  .../status/route.ts
//
// answer/route.ts: read SpeechResult / Digits, record ok/not-ok for this step,
// decide the next step, and either <Redirect> to the next question or say goodbye
// and <Hangup>. CRITICAL RULE PRESERVED: if VIN is "no", we stop and HOLD —
// never proceed to collect on a similar reference (this is the guard, in code).
//
// export async function POST(req: Request) {
//   if (!(await verifyTwilioSignature(req))) return new NextResponse("forbidden", { status: 403 })
//   const url = new URL(req.url)
//   const callId = url.searchParams.get("callId")!
//   const step = url.searchParams.get("step")!
//   const form = await req.formData()
//   const digits = String(form.get("Digits") ?? "")
//   const speech = String(form.get("SpeechResult") ?? "").toLowerCase()
//   const yes = digits === "1" || /\b(yes|yep|correct|confirmed|affirmative)\b/.test(speech)
//   const no  = digits === "2" || /\b(no|nope|negative|not)\b/.test(speech)
//   const ok = yes && !no
//   appendTranscript(callId, { who: "desk", text: speech || (digits ? `pressed ${digits}` : "(no clear answer)") })
//   await recordChecklist(callId, step, ok) // maps step -> ReadyItem, same labels as the mock
//
//   const vr = new TwiML.VoiceResponse()
//   const base = process.env.PUBLIC_BASE_URL!
//   const next: Record<string, string | null> = { vin: ok ? "keys" : null, keys: "bay", bay: null }
//   const to = next[step]
//   if (step === "vin" && !ok) {
//     // GUARD: a similar reference is not a match. Hold, do not substitute.
//     appendTranscript(callId, { who: "agent", text: "A similar reference isn't a match. We won't collect. Please locate the exact VIN — our driver is on site and holding." })
//     await finalise(callId, { held: true })
//     vr.say("Understood. We will hold collection until the exact V I N is located. Thank you.")
//     vr.hangup()
//   } else if (to) {
//     vr.redirect(`${base}/api/voice/pickup/twiml?callId=${callId}&step=${to}`)
//   } else {
//     await finalise(callId, { held: false })
//     vr.say("Thank you, that's everything we needed.")
//     vr.hangup()
//   }
//   return new NextResponse(vr.toString(), { headers: { "content-type": "text/xml" } })
// }
//
// status/route.ts: on "no-answer"/"busy", bump attempts and re-dial up to 2 (the
// mock's "ring, no answer, retry" behaviour, made real). On "completed", mark the
// row done so GET /call/:callId returns the assembled PickupCall. On voicemail
// (AnsweredBy=machine*), hang up and retry rather than leave a message.
//
// ---- 2d) Call store (persist across webhooks)  -> lib/agent/call-store.ts ------
//        plus a Drizzle table in lib/schema.ts:
//
// export const pickupCalls = pgTable("pickup_calls", {
//   id: text("id").primaryKey(),                 // our callId (uuid)
//   callSid: text("call_sid"),                   // Twilio's SID
//   orderRef: text("order_ref").notNull(),
//   vehicle: text("vehicle").notNull(),
//   vin: text("vin"),
//   site: text("site").notNull(),
//   status: text("status").notNull().default("dialing"), // dialing|in_progress|completed|no_answer|failed
//   attempts: integer("attempts").notNull().default(0),
//   reached: boolean("reached").notNull().default(false),
//   held: boolean("held").notNull().default(false),
//   transcript: jsonb("transcript").notNull().default([]), // CallLine[]
//   checklist: jsonb("checklist").notNull().default([]),    // ReadyItem[]
//   createdAt: timestamp("created_at").notNull().defaultNow(),
// })
//
// createPickupCallRow(ctx) seeds the row (site/ref/vehicle/vin + the "Dialing…"
// system line). appendTranscript / recordChecklist patch the jsonb columns.
// finalise() computes `ready = checklist.every(ok)` and `outcome` with the EXACT
// strings runPickupCall() uses, so the UI reads identically.
//
// ---- 2e) assemble the PickupCall the UI already knows -------------------------
//
// export function assemblePickupCall(row): PickupCall {
//   return {
//     site: row.site, reference: row.orderRef, attempts: row.attempts, reached: row.reached,
//     ready: row.checklist.length > 0 && row.checklist.every((i) => i.ok),
//     transcript: row.transcript, checklist: row.checklist,
//     outcome: row.held
//       ? `Not ready — the exact car isn't confirmed. Collection on hold; driver waiting. Asked the branch to locate VIN ${row.vin ?? "the recorded VIN"}.`
//       : (row.checklist.every((i) => i.ok)
//           ? "Ready — car, keys and release confirmed. The driver can collect."
//           : "Mostly ready — only the bay is pending; the desk assigns it on check-in."),
//   }
// }
//
// =============================================================================
// 3) MODE B — CONVERSATIONAL VOICE AGENT (free back-and-forth)
// =============================================================================
// Mode A only handles fixed yes/no prompts. A branch clerk who says "give me a
// sec… which model again?" needs real dialogue. That is a VOICE-AGENT layer, not
// just Twilio. Two routes:
//
//  (a) MANAGED (recommended for pilot): Vapi / Bland.ai / Retell. You POST a
//      call request with a system prompt + the readiness checklist as the goal
//      and your questions; they run the STT -> LLM -> TTS loop over the PSTN and
//      POST a structured transcript + extracted fields to a webhook. We reuse the
//      SAME system prompt and guard rules the text agent uses (lib/agent/*), so
//      the policy ("similar ref is not a match", "never clear the car to drive")
//      stays in one place. Wiring is the same shape as §2: start -> webhook
//      assembles a PickupCall.
//
//      // example (Vapi):
//      // await fetch("https://api.vapi.ai/call/phone", {
//      //   method: "POST",
//      //   headers: { authorization: `Bearer ${process.env.VAPI_API_KEY}`, "content-type": "application/json" },
//      //   body: JSON.stringify({
//      //     phoneNumberId: process.env.VAPI_FROM_ID,
//      //     customer: { number: branchNumber },
//      //     assistant: {
//      //       model: { provider: "mistral", model: "ministral-8b-2512", messages: [{ role: "system", content: PICKUP_CALL_SYSTEM_PROMPT }] },
//      //       voice: { provider: "11labs", voiceId: "..." },
//      //       serverUrl: `${process.env.PUBLIC_BASE_URL}/api/voice/pickup/vapi-webhook`,
//      //     },
//      //   }),
//      // })
//
//  (b) SELF-HOSTED: Twilio <Connect><Stream> (Media Streams) -> a WebSocket that
//      pipes audio to STT (Deepgram/Whisper) -> our LLM loop -> TTS (ElevenLabs/
//      Twilio) -> back over the stream. Full control, more moving parts, latency
//      tuning. Only worth it past a pilot.
//
// Either way, the OUTPUT is normalised back into PickupCall, so none of the room
// UI changes. The agent's brain (prompt, tools, guards) is shared with the text
// path — the call is just another transport for the same decision.
//
// =============================================================================
// 4) WIRING IT IN  -> the commented branch in app/api/orders/[id]/call/route.ts
// =============================================================================
// Today that route always runs the mock. The live branch (kept commented there)
// is simply:
//
//   // import { liveTelephonyEnabled, pickProvider, resolveBranchNumber } from "@/lib/agent/telephony"
//   // const branch = place ? resolveBranchNumber(place.details) : null
//   // if (liveTelephonyEnabled() && branch) {
//   //   const started = await pickProvider().startPickupCall(ctx, branch)
//   //   return NextResponse.json({ status: "dialing", callId: started.callId })
//   // }
//   // ...else fall through to the mock (runPickupCall) exactly as now.
//
// And the room's PickupPhone component gains a poll: after "dialing", GET
// /api/orders/[id]/call/[callId] every ~2s until status === "completed", then
// render the assembled PickupCall with the existing markup. No visual change for
// the mock path.
//
// =============================================================================
// 5) SECURITY, COMPLIANCE, OPS — do not skip before a real pilot
// =============================================================================
//  * Webhook auth: verify X-Twilio-Signature on EVERY Twilio webhook
//    (twilio.validateRequest(authToken, signature, fullUrl, params)). Reject
//    otherwise — these endpoints are public. (lib/agent/twilio-verify.ts)
//  * Numbers: store/dial E.164 only; validate before calling; never dial a
//    number that isn't an approved branch/site.
//  * Consent/recording: call recording is two-party-consent in many places (incl.
//    parts of the EU). Announce recording or don't record; check per-country.
//  * Scope: this agent calls BRANCHES/SITES only. It must NEVER auto-dial a
//    customer — same rule as the rest of the room. Enforce an allowlist by role.
//  * Rate limits + idempotency: cap retries at 2 (matches the mock), dedupe on
//    callSid so a replayed webhook can't double-append the transcript.
//  * Cost + abuse: per-order call cap, and a kill switch (unset CALL_CENTER_FROM)
//    that instantly reverts the whole app to the mock with zero code change.
//  * Secrets: TWILIO_AUTH_TOKEN etc. live in env only (already .gitignored).
//
// =============================================================================
// Inert module marker — the only compiled line in this file. Exports nothing,
// imported nowhere, runs never. Keeps tsc happy under isolatedModules.
export {}
