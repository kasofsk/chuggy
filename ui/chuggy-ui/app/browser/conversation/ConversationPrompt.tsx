/**
 * What stands ahead of a run's thread: the prompt the run was handed, as the
 * first message on the member's side, and the read of the batches below the
 * ones the page holds.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { runPromptHead } from "../../core/runConfiguration.ts";
import type { RunPrompt } from "../../core/runConfiguration.ts";
import { Button } from "../ui/Button.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";

/** An earlier read the page can make, and whether one is already out. */
export interface ConversationEarlierProps {
  readonly busy: boolean;
  readonly onRead: () => void;
}

/** Folded to its opening lines, because a prompt is pages long and the thread
 * under it is what a reader came for. */
function ConversationPromptKept(props: { readonly text: string }): ReactNode {
  const [full, setFull] = useState(false);
  const head = runPromptHead(props.text);
  return (
    <div className="flex flex-col items-end gap-2">
      <span className="text-ink-3 text-xs">Prompt</span>
      <div className="bg-bubble rounded-3 max-w-[85%] min-w-0 px-4 py-3">
        <MarkdownReport text={full ? props.text : head.head} bare />
      </div>
      {head.cut ? (
        <Button
          variant="quiet"
          size="sm"
          expanded={full}
          onClick={() => {
            setFull(!full);
          }}
        >
          {full ? "Hide full prompt" : "Show full prompt"}
        </Button>
      ) : null}
    </div>
  );
}

export function ConversationPrompt(props: {
  readonly prompt: RunPrompt;
}): ReactNode {
  const prompt = props.prompt;
  switch (prompt.prompt) {
    case "Kept":
      return <ConversationPromptKept text={prompt.text} />;
    case "NotKept":
      return <p className="text-ink-3 self-end text-sm">Prompt not kept</p>;
    case "Unreadable":
      return <p className="text-ink-3 self-end text-sm">Prompt unreadable</p>;
  }
}

export function ConversationEarlier(
  props: ConversationEarlierProps,
): ReactNode {
  return (
    <div className="flex justify-center">
      <Button
        variant="quiet"
        size="sm"
        busy={props.busy}
        disabled={props.busy}
        onClick={props.onRead}
      >
        Earlier
      </Button>
    </div>
  );
}
