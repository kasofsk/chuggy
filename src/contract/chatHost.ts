/**
 * The protocol between a member's chat host and the supervisor in its chat
 * container. The host holds the pool's poll and tells the supervisor which
 * sessions to start and stop; the supervisor runs each as a user of its own and
 * says when each started and when each ended. They release separately, so the
 * frames are versioned here rather than by either of them.
 *
 * A FRAME IS ONE LINE OF JSON, the host's on the supervisor's standard input
 * and the supervisor's on its standard output, no longer than
 * `chatProtocolFrameBytesMax`. The supervisor speaks first, with `Ready`, and a
 * host that speaks none of the versions it names sends it nothing. `Ready` is
 * the one frame read without refusing a field it does not name, so a later
 * supervisor's stays readable; every other frame is strict. A supervisor writes
 * this version's frames until a host frame names another.
 *
 * EVERY `Start` IS ANSWERED ONCE, by `Started` or by `Refused`. A refusal is
 * final for the `Start` it answers, and no `Ended` follows it; a `Duplicate`
 * leaves the earlier `Start`'s own answer and its `Ended` standing. A `Start`
 * for an assignment the supervisor already prepares or runs is refused with
 * `Duplicate`, ahead of every other reason, `Draining` included. Every
 * `Started` is followed by exactly one `Ended`, whether the session ended by
 * itself, by `Stop`, or by the end of the host's stream. A session being
 * prepared counts wherever a running one does, toward `sessionsMax` included.
 *
 * A `Stop` while its session is being prepared cancels the preparation and is
 * answered by `Refused` with `Stopped`; one for an assignment the supervisor
 * neither prepares nor runs is answered by nothing. After `Drain` the
 * supervisor refuses every `Start` that is not a `Duplicate` with `Draining`
 * and lets each running session end on its own; once every `Start` read
 * before `Drain` is answered and every `Started` has its `Ended`, it writes
 * `Drained` and exits. At the end of its standard input it answers every
 * preparation with `Refused` and `Stopped`, stops every running session and
 * writes its `Ended`, and exits.
 *
 * A SESSION'S BEARER CROSSES ONLY IN `Start`, and no refusal raised here
 * repeats the line it read.
 */

import { z } from "zod";

import { textUtf8Bytes } from "./http.ts";
import { sessionEndedSchema } from "./sessionPlane.ts";
import { workerContractVersionOf } from "./workerContract.ts";
import { workerPoolAssignmentIdentitySchema } from "./workerPool.ts";
import { poolEnvelopeSchema } from "./workerTask.ts";

/** The version of the protocol this release describes. */
export const chatProtocolVersion = 1;

/** The longest frame either side writes, in UTF-8, its newline left out. */
export const chatProtocolFrameBytesMax = 16_384;

/** What a session is started with: a pool's envelope less its workspace, because the supervisor makes one directory per session for that session's user. */
export const chatHostSessionEnvelopeSchema = z.strictObject(
  poolEnvelopeSchema.omit({ workspace: true }).shape,
);

/** Start the session the pool's poll handed the host under `assignment`. */
export const chatHostStartSchema = z.strictObject({
  frame: z.literal("Start"),
  assignment: workerPoolAssignmentIdentitySchema,
  envelope: chatHostSessionEnvelopeSchema,
});

/** End a session, or cancel one being prepared. */
export const chatHostStopSchema = z.strictObject({
  frame: z.literal("Stop"),
  assignment: workerPoolAssignmentIdentitySchema,
});

/** Start nothing more, and wait for every running session to end on its own, which `Drained` says. */
export const chatHostDrainSchema = z.strictObject({
  frame: z.literal("Drain"),
});

/** What the host writes. */
export const chatHostFrameSchema = z.discriminatedUnion("frame", [
  chatHostStartSchema,
  chatHostStopSchema,
  chatHostDrainSchema,
]);

/**
 * The supervisor's first frame: the versions of this protocol it speaks, how
 * many sessions it prepares or runs at once, and the release of this contract
 * it was built against. A field it does not name is dropped rather than refused.
 */
export const chatSupervisorReadySchema = z.object({
  frame: z.literal("Ready"),
  protocols: z.array(z.number().int().positive().safe()).min(1),
  sessionsMax: z.number().int().positive().safe(),
  contractRelease: z
    .string()
    .refine((release) => workerContractVersionOf(release) !== undefined),
});

/** A session the supervisor started. */
export const chatSupervisorStartedSchema = z.strictObject({
  frame: z.literal("Started"),
  assignment: workerPoolAssignmentIdentitySchema,
});

/**
 * Why a supervisor did not start a session, each asking something different
 * of the host: `Full`, it already prepares or runs as many sessions as its
 * `Ready` named; `Draining`, it was told to drain; `Duplicate`, ahead of every
 * other reason, it already prepares or runs that assignment under an earlier
 * `Start`; `Unprepared`, the session's user, directory or credential could not
 * be made, which is that session's failure rather than the supervisor's;
 * `Stopped`, a `Stop` or the end of the host's stream came while it was being
 * prepared, which is the end the host asked for.
 */
export const chatSupervisorRefusals = [
  "Full",
  "Draining",
  "Duplicate",
  "Unprepared",
  "Stopped",
] as const;
export type ChatSupervisorRefusal = (typeof chatSupervisorRefusals)[number];

/** A `Start` that did not become a session. */
export const chatSupervisorRefusedSchema = z.strictObject({
  frame: z.literal("Refused"),
  assignment: workerPoolAssignmentIdentitySchema,
  reason: z.enum(chatSupervisorRefusals),
});

/** A session whose process has ended, in the phase the host reports to `POST /v1/session/ended` under its bearer. */
export const chatSupervisorEndedSchema = z.strictObject({
  frame: z.literal("Ended"),
  assignment: workerPoolAssignmentIdentitySchema,
  phase: sessionEndedSchema.shape.phase,
});

/** Every `Start` read before `Drain` is answered and every `Started` has its `Ended`, and the supervisor exits. */
export const chatSupervisorDrainedSchema = z.strictObject({
  frame: z.literal("Drained"),
});

/** What the supervisor writes. */
export const chatSupervisorFrameSchema = z.discriminatedUnion("frame", [
  chatSupervisorReadySchema,
  chatSupervisorStartedSchema,
  chatSupervisorRefusedSchema,
  chatSupervisorEndedSchema,
  chatSupervisorDrainedSchema,
]);

export type ChatHostSessionEnvelope = z.infer<
  typeof chatHostSessionEnvelopeSchema
>;
export type ChatHostFrame = z.infer<typeof chatHostFrameSchema>;
export type ChatSupervisorReady = z.infer<typeof chatSupervisorReadySchema>;
export type ChatSupervisorFrame = z.infer<typeof chatSupervisorFrameSchema>;

/** Whether a supervisor's `Ready` names the version this release speaks. */
export function chatProtocolSpoken(ready: ChatSupervisorReady): boolean {
  return ready.protocols.includes(chatProtocolVersion);
}

/** A line refused before it is read, where it is longer than a frame may be. */
function chatProtocolLineBounded(line: string): string {
  if (textUtf8Bytes(line) > chatProtocolFrameBytesMax)
    throw new RangeError("a chat frame is longer than its bound");
  return line;
}

/** A line's JSON, refused by a message that does not quote it as a parser's would. */
function chatProtocolLineJson(line: string): unknown {
  const bounded = chatProtocolLineBounded(line);
  try {
    return JSON.parse(bounded) as unknown;
  } catch {
    throw new SyntaxError("a chat frame is not JSON");
  }
}

/** A line the supervisor read from the host, its newline left out. */
export function parseChatHostFrame(line: string): ChatHostFrame {
  return chatHostFrameSchema.parse(chatProtocolLineJson(line));
}

/** A line the host read from the supervisor, its newline left out. */
export function parseChatSupervisorFrame(line: string): ChatSupervisorFrame {
  return chatSupervisorFrameSchema.parse(chatProtocolLineJson(line));
}

/** A frame as either side writes it, its newline included, refused where it is longer than a frame may be. */
export function chatProtocolLine(
  frame: ChatHostFrame | ChatSupervisorFrame,
): string {
  return `${chatProtocolLineBounded(JSON.stringify(frame))}\n`;
}
