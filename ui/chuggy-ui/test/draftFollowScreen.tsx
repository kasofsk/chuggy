/**
 * What the screens following a server draft are driven by in their suites: a
 * revision arriving as the project stream's frame for it, the title box a
 * case types into, the notice a revision past what is typed draws, and a
 * probe standing where a thread's composer would, asking for the save a send
 * asks for.
 */

import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import type { DraftResponse } from "../../../src/contract/responses.ts";
import { useDraftSavedBeforeSend } from "../app/browser/editor/draftSaveBeforeSend.tsx";
import { draftFollowBehindSentence } from "../app/core/draftFollow.ts";
import { settled, turned } from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";

/** The agent's revision arriving as the stream's frame for it. */
export async function followArrives(
  server: StreamServer,
  draft: DraftResponse,
): Promise<void> {
  await turned(() => {
    server.push(
      frame("Draft", String(draft.authoringVersion), {
        version: 1,
        resource: String(draft.ticket),
        representation: draft,
      }),
    );
  });
  await settled();
}

export function followTitle(): HTMLInputElement {
  return screen.getByPlaceholderText<HTMLInputElement>(
    "what this ticket is called",
  );
}

export function followRetitled(value: string): void {
  fireEvent.change(followTitle(), { target: { value } });
}

/** The notice draft 12's form draws once a revision moved past what is typed. */
export function followBehind(): HTMLElement | null {
  return screen.queryByText(draftFollowBehindSentence(12));
}

/** What the probe was answered each time it asked, in order, which a case
 * empties before it draws. */
export const followSendsAsked: boolean[] = [];

/** Stands where a thread's composer would, asking for the save a send asks for. */
export function FollowSendProbe(): ReactNode {
  const saved = useDraftSavedBeforeSend();
  return (
    <button
      type="button"
      onClick={() => {
        void Promise.resolve(saved()).then((answered) => {
          followSendsAsked.push(answered);
        });
      }}
    >
      probe send
    </button>
  );
}
