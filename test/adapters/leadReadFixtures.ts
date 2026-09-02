/**
 * The lead-side reads as a suite that is not about them answers them: nothing
 * found. They are registered unconditionally, so every served boundary carries
 * them, and a suite about drafts should not have to invent a lead to say so.
 */

import type { NativeWeb } from "../../src/interpreter/nativeWeb.ts";

type LeadReads = Pick<
  NativeWeb,
  | "lead"
  | "leadTranscript"
  | "agenticRefusals"
  | "ticketAgenticRefusals"
  | "selectorHistory"
>;

export function unreadableLeadReads(): LeadReads {
  const missing = () => Promise.resolve({ result: "NotFound" } as const);
  return {
    lead: missing,
    leadTranscript: () => Promise.resolve({ read: "NotFound" } as const),
    agenticRefusals: missing,
    ticketAgenticRefusals: missing,
    selectorHistory: missing,
  };
}
