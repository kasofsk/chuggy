/**
 * A form open on a server draft saving its edits before the reader's thread
 * is sent a message, so the agent reads the draft the reader sees.
 *
 * THE FORM OFFERS THE SAVE AND THE COMPOSER ASKS FOR IT. A form following a
 * draft offers a save while it holds edits its draft does not, and the shell
 * holds the one offered; a project thread's composer asks for it before every
 * send and sends nothing where it was refused. What a refusal says is the
 * form's to draw, where it draws its own, so the composer only keeps what was
 * typed.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { DraftResponse } from "../../../../../src/contract/responses.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { draftRevisionSchema } from "../../../../../src/contract/requests.ts";
import type { z } from "zod";

import type { ApiPorts } from "../../core/apiRequest.ts";
import type { Copy } from "../../core/copy.ts";
import type { CreationFault } from "../../core/ticketCreation.ts";
import { draftRevisionSaved } from "../../core/ticketCreationRun.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";

/** Whether the edits are on the draft now, or the send is to wait for the
 * reader. */
export type DraftSaved = "Saved" | "Refused";

type DraftSave = () => Promise<DraftSaved>;

/** The one save offered at a time, which a form offers and withdraws and a
 * composer asks for. */
class DraftSaveHolder {
  #save: DraftSave | undefined;

  /** Holds `save` as the one offered, answering how to withdraw it. */
  offered(save: DraftSave): () => void {
    this.#save = save;
    return () => {
      if (this.#save === save) this.#save = undefined;
    };
  }

  /** Whether a send may go ahead, answered at once where none is offered,
   * there being nothing to save, so a send with no form beside it waits on
   * nothing. */
  saved(): true | Promise<boolean> {
    const save = this.#save;
    if (save === undefined) return true;
    return save().then((saved) => saved === "Saved");
  }
}

const DraftSaves = createContext(new DraftSaveHolder());

/** Holds the save the form drawn beside the composer offers. */
export function DraftSaveHeld(props: {
  readonly children: ReactNode;
}): ReactNode {
  const [held] = useState(() => new DraftSaveHolder());
  return (
    <DraftSaves.Provider value={held}>{props.children}</DraftSaves.Provider>
  );
}

/** Saves whatever form offers a save, answering whether a send may go ahead. */
export function useDraftSavedBeforeSend(): () => true | Promise<boolean> {
  const held = useContext(DraftSaves);
  return useCallback(() => held.saved(), [held]);
}

/** What a form's note draws: the refusal of its last save where there is
 * one, which it draws where it draws its own submit's, and else that submit. */
export function draftSaveAttempt<Drawn extends { readonly attempt: string }>(
  refusal: string | undefined,
  attempt: Drawn,
):
  | Drawn
  | {
      readonly attempt: "Failed";
      readonly reason: string;
      readonly held: undefined;
    } {
  return refusal === undefined
    ? attempt
    : { attempt: "Failed", reason: refusal, held: undefined };
}

/** What a revision of the draft a form holds comes to, before it is sent. */
export type DraftSaveAssembled =
  | {
      readonly assembled: "Body";
      readonly revision: z.infer<typeof draftRevisionSchema>;
    }
  | { readonly assembled: "Faults"; readonly faults: readonly CreationFault[] };

/** The line a form whose edits do not assemble says in place of a save. */
export const draftSaveFaultsSentence: Copy = {
  id: "ticket-authoring-draft-unsaved",
};

/** What a form following a draft hands the save it offers. */
export interface DraftSaveOffer {
  readonly ports: ApiPorts;
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  /** Whether the form holds edits its draft does not and may write now. */
  readonly offered: boolean;
  readonly assemble: () => DraftSaveAssembled;
  readonly onFaults: (faults: readonly CreationFault[]) => void;
  /** The revision a save wrote, which the form then stands on. */
  readonly onSaved: (draft: DraftResponse) => void;
}

/** What the form draws of its save: why the last one wrote none. */
export interface DraftSaving {
  readonly refusal: string | undefined;
  readonly cleared: () => void;
}

/**
 * The save a form following a draft offers while it holds edits, held by the
 * shell for as long as it does. Each save writes the revision the form
 * assembles at the moment it is asked, so it is the form as the reader left
 * it that the agent reads.
 */
export function useDraftSaveOffered(offer: DraftSaveOffer): DraftSaving {
  const held = useContext(DraftSaves);
  const [refusal, setRefusal] = useState<string>();
  const text = useCopyText();
  const latest = useRef(offer);
  useEffect(() => {
    latest.current = offer;
  });
  const { offered } = offer;
  useEffect(() => {
    if (!offered) return undefined;
    const save: DraftSave = async () => {
      const now = latest.current;
      const assembled = now.assemble();
      if (assembled.assembled === "Faults") {
        now.onFaults(assembled.faults);
        setRefusal(text(draftSaveFaultsSentence));
        return "Refused";
      }
      const ended = await draftRevisionSaved(
        now.ports,
        now.partition,
        now.ticket,
        assembled.revision,
        text,
      );
      if (ended.saved === "Refused") {
        setRefusal(ended.reason);
        return "Refused";
      }
      setRefusal(undefined);
      now.onSaved(ended.draft);
      return "Saved";
    };
    return held.offered(save);
  }, [held, offered, text]);
  return {
    refusal,
    cleared: () => {
      setRefusal(undefined);
    },
  };
}
