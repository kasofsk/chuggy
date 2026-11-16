/**
 * One session's store read a page at a time, and the frame that says it moved.
 *
 * The store is written so that a walk over it meets every shape a page has: one
 * wholly below the cut holding none of its entries, one carrying the boundary
 * and holding it, and pages above it holding all of theirs. So a case can tell
 * "held" from "read", and can tell where the seam is drawn from whether it is
 * drawn at all.
 */

import type { LeadTranscriptResponse } from "../../../src/contract/responses.ts";

export const transcriptStream = "1a2b3c";

/** The boundary the last compaction cut at, which is the first entry held. */
export const transcriptBoundaryUuid = "uuid-c";

function sessionTranscriptEntry(
  uuid: string,
  type: string,
  text: string,
): LeadTranscriptResponse["entries"][number] {
  return {
    uuid,
    type,
    timestamp: "2026-09-01T10:00:00Z",
    message: { content: [{ type: "text", text }] },
  };
}

/**
 * The store, a batch at a time. The first batch is wholly below the cut and the
 * second ends on the compaction summary, so a walk over this store meets a page
 * holding none of its entries, a page holding some of them, and pages holding
 * all of them.
 */
const sessionTranscriptBatchEntries: readonly (readonly LeadTranscriptResponse["entries"][number][])[] =
  [
    [
      sessionTranscriptEntry("uuid-p", "user", "observation-1-before-cut"),
      sessionTranscriptEntry("uuid-q", "assistant", "decision-1-before-cut"),
    ],
    [
      sessionTranscriptEntry("uuid-a", "user", "first observation"),
      sessionTranscriptEntry("uuid-b", "assistant", "first decision"),
      sessionTranscriptEntry(
        transcriptBoundaryUuid,
        "user",
        "compaction summary",
      ),
    ],
    [sessionTranscriptEntry("uuid-d", "assistant", "second decision")],
    [sessionTranscriptEntry("uuid-e", "assistant", "third decision")],
  ];

/** The batch the stream's one compaction falls in, which every page decided
 * against answers with. */
export const transcriptCutBatch = 2;

/**
 * Which of a page's own entries the lead still holds, decided by the cut in the
 * whole stream and not by what the page happens to carry: none of them on a
 * batch below the cut, and the boundary on where the page holds it. `after` is
 * the cursor the page was asked with, so the batch it answers is `after + 1`.
 */
function sessionTranscriptHeldOf(
  after: number,
  entries: readonly LeadTranscriptResponse["entries"][number][],
): readonly string[] {
  if (after < transcriptCutBatch - 1) return [];
  const at = entries.findIndex(
    (entry) => entry.uuid === transcriptBoundaryUuid,
  );
  return entries
    .slice(at < 0 ? 0 : at)
    .flatMap((entry) => (entry.uuid === undefined ? [] : [entry.uuid]));
}

/**
 * One page of the store: one batch, so `nextAfter` is present exactly where the
 * page filled its limit and a final full page is followed by an empty one.
 * Every page answers `held` over its own entries — possibly none of them — and
 * absence is reserved for a read that could not decide it.
 */
export function sessionTranscriptPage(
  after: number,
  batches: number,
): LeadTranscriptResponse {
  const entries =
    after < batches ? (sessionTranscriptBatchEntries[after] ?? []) : [];
  const at = entries.findIndex(
    (entry) => entry.uuid === transcriptBoundaryUuid,
  );
  return {
    stream: transcriptStream,
    entries: [...entries],
    held: [...sessionTranscriptHeldOf(after, entries)],
    cut: transcriptCutBatch,
    ...(at < 0
      ? {}
      : {
          compaction: {
            boundary: transcriptBoundaryUuid,
            at: "2026-09-01T10:00:00Z",
          },
        }),
    elided: 0,
    truncated: false,
    ...(entries.length === 0 ? {} : { nextAfter: after + 1 }),
  };
}

/**
 * The resource a `Session` change frame carries: the session, what kind of
 * session it is, and the turn that moved. The kind is the SESSION's own, read
 * from its row by the trigger that writes the frame — not a name for what moved
 * — which is what lets a panel watch one kind of session across a project that
 * holds several.
 */
export function sessionChangeResource(
  session: string,
  turn: string,
  kind = "Lead",
): string {
  return JSON.stringify({ session, kind, turn });
}
