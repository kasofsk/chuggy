/** The note a lead leaves a successor with nothing else to read yet. */

import type { ReactNode } from "react";

import type { LeadHandoffNote } from "../../core/leadTranscript.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { ConversationCard } from "../conversation/ConversationCard.tsx";
import { Pill } from "../ui/Pill.tsx";

/** The note a lead leaves a successor that has no transcript, as much of it as
 * the lead read carries. */
export function LeadNote(props: {
  readonly note: LeadHandoffNote | undefined;
}): ReactNode {
  const text = useCopyText();
  const note = props.note;
  if (note === undefined || note.bytes === 0) return null;
  return (
    <div className="max-w-page mx-auto w-full px-4 pt-4">
      <ConversationCard
        label={
          <span className="flex flex-wrap items-center gap-2">
            <span>{text({ id: "lead-handoff-note" })}</span>
            <span className="text-ink-3 tabular-nums">{note.bytes}</span>
            {note.truncated ? (
              <Pill tone="parked">
                {text({ id: "lead-handoff-truncated" })}
              </Pill>
            ) : null}
          </span>
        }
      >
        <pre className="max-h-(--height-clip) overflow-auto">
          {note.preview}
        </pre>
      </ConversationCard>
    </div>
  );
}
