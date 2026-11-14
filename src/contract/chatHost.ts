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
 * supervisor refuses every `Start` that is not a `Duplicate` with `Draining`,
 * ends each session that holds no claimed turn as a `Stop` would, and ends one
 * that holds a claimed turn once that turn settles; once every `Start` and
 * every `Forget` read before `Drain` is answered and every `Started` has its
 * `Ended`, it writes `Drained` and exits. A session holds a claimed turn from
 * the session plane's answer handing it one until it answers, fails or stops
 * that turn there. Only the session sees either, so its supervisor learns both
 * from the session itself, on the channel it runs the session over, which is
 * the supervisor's own and not this protocol's. At the end of its standard
 * input it answers every preparation with `Refused` and `Stopped`, stops every
 * running session and writes its `Ended`, answers every `Forget` it holds,
 * and exits.
 *
 * A THREAD'S SESSIONS KEEP ONE DIRECTORY. A `Start` for an attempt of a thread
 * names that thread, and the supervisor gives the session a directory kept for
 * the thread rather than one made for it: owned by the session's user while it
 * runs, given to no session of any other thread, and kept after the session
 * ends, in the volume the supervisor keeps its sessions' directories in, which
 * is named for the host and outlives the supervisor's container. Everything
 * else a session is given is removed when it ends, and a `Start` naming no
 * thread is given nothing that is kept. A `Start` for a thread another session
 * of which is prepared or running is prepared once that session has ended, and
 * one for a thread named by a `Forget` not yet answered is refused
 * `Unprepared`.
 *
 * A THREAD'S DIRECTORY IS REMOVED ONLY BY `Forget`, which names a thread the
 * pool's answer named as closed. Once no session of that thread is prepared or
 * running, the supervisor removes its directory and answers with `Forgotten`,
 * and it answers a thread it keeps no directory for the same way, so every
 * `Forget` is answered by one `Forgotten`.
 *
 * A SESSION'S BEARER CROSSES ONLY IN `Start`, and no refusal raised here
 * repeats the line it read. A credential crosses only by name: a `Start` may
 * name which of the credentials its host handed the supervisor the session
 * runs on, and one that names none runs on the one it was handed, as every
 * session of version 1 did. A named credential the supervisor holds no file
 * for is refused `Unprepared`.
 *
 * VERSION 2 added the credential a `Start` names. Every frame of version 1
 * reads unchanged in version 2.
 *
 * VERSION 3 added the thread a `Start` names and the directory kept for it,
 * `Forget` and `Forgotten`, and a `Drain` that ends each session holding no
 * claimed turn rather than waiting on it. Every frame of version 2 reads
 * unchanged in version 3.
 */

import { z } from "zod";

import { textUtf8Bytes } from "./http.ts";
import { sessionEndedSchema } from "./sessionPlane.ts";
import { workerContractVersionOf } from "./workerContract.ts";
import {
  workerPoolAssignmentIdentitySchema,
  workerPoolThreadClosedSchema,
} from "./workerPool.ts";
import { poolEnvelopeSchema } from "./workerTask.ts";

/** The version of the protocol this release describes. */
export const chatProtocolVersion = 3;

/** The longest frame either side writes, in UTF-8, its newline left out. */
export const chatProtocolFrameBytesMax = 16_384;

/** What a session is started with: a pool's envelope less its workspace, because the supervisor gives each session's user its directory: its thread's where its `Start` names one, and otherwise one made for that session. */
export const chatHostSessionEnvelopeSchema = z.strictObject(
  poolEnvelopeSchema.omit({ workspace: true }).shape,
);

/** A credential as a host names it to its supervisor: its agent, its type, and its name, which is unique across the host's agents and is never the secret. */
export const chatHostCredentialSchema = z.strictObject({
  agent: z.enum(["Claude", "Codex"]),
  type: z.enum(["OAuth", "ApiKey", "Bedrock", "Vertex", "Foundry"]),
  name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
});

/** Start the session the pool's poll handed the host under `assignment`, on the credential it names where it names one, and in the directory kept for the thread it names where it names one, as the poll named it. */
export const chatHostStartSchema = z.strictObject({
  frame: z.literal("Start"),
  assignment: workerPoolAssignmentIdentitySchema,
  envelope: chatHostSessionEnvelopeSchema,
  credential: chatHostCredentialSchema.exactOptional(),
  thread: workerPoolThreadClosedSchema.exactOptional(),
});

/** End a session, or cancel one being prepared. */
export const chatHostStopSchema = z.strictObject({
  frame: z.literal("Stop"),
  assignment: workerPoolAssignmentIdentitySchema,
});

/** Start nothing more, and end every session once it holds no claimed turn, which `Drained` says. */
export const chatHostDrainSchema = z.strictObject({
  frame: z.literal("Drain"),
});

/** Remove the directory kept for a thread the pool's answer named as closed, once no session of it is prepared or running. */
export const chatHostForgetSchema = z.strictObject({
  frame: z.literal("Forget"),
  thread: workerPoolThreadClosedSchema,
});

/** What the host writes. */
export const chatHostFrameSchema = z.discriminatedUnion("frame", [
  chatHostStartSchema,
  chatHostStopSchema,
  chatHostDrainSchema,
  chatHostForgetSchema,
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
 * be made, its thread's directory included, which is that session's failure
 * rather than the supervisor's; `Stopped`, a `Stop`, a `Drain` or the end of
 * the host's stream came while it was being prepared, which is the end the
 * host asked for.
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

/** Every `Start` and every `Forget` read before `Drain` is answered and every `Started` has its `Ended`, and the supervisor exits. */
export const chatSupervisorDrainedSchema = z.strictObject({
  frame: z.literal("Drained"),
});

/** A thread a `Forget` named whose directory the supervisor no longer keeps. */
export const chatSupervisorForgottenSchema = z.strictObject({
  frame: z.literal("Forgotten"),
  thread: workerPoolThreadClosedSchema,
});

/** What the supervisor writes. */
export const chatSupervisorFrameSchema = z.discriminatedUnion("frame", [
  chatSupervisorReadySchema,
  chatSupervisorStartedSchema,
  chatSupervisorRefusedSchema,
  chatSupervisorEndedSchema,
  chatSupervisorDrainedSchema,
  chatSupervisorForgottenSchema,
]);

export type ChatHostSessionEnvelope = z.infer<
  typeof chatHostSessionEnvelopeSchema
>;
export type ChatHostCredential = z.infer<typeof chatHostCredentialSchema>;
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
