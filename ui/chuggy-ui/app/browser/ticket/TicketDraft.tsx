/**
 * A draft never released, drawn as the ticket page draws a ticket: the Draft
 * label and "Not released", Release, Edit, which opens the form, and a menu
 * holding Duplicate, Copy link and Delete draft, over the same tabs.
 *
 * Release is the form's own `ReleaseDraft`, fenced at the version the page
 * read, and followed as any of the ticket's actions is; the ticket it makes is
 * read again, and the page draws it in the draft's place. Delete is fenced the
 * same way and goes back to the ticket list once it lands.
 */

import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { DraftResponse } from "../../../../../src/contract/responses.ts";
import { apiDeleteDraft } from "../../core/apiRoutes.ts";
import { ticketActionEffect } from "../../core/codeLabels.ts";
import { draftDeletionFailureSentence } from "../../core/codeSentences.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import { draftReleaseAction } from "../../core/ticketActions.ts";
import {
  ticketDraftPageFacts,
  ticketDraftTitleOf,
} from "../../core/ticketPageFacts.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { FreshnessInstants } from "../Freshness.tsx";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { FollowNotes, TicketActingScope } from "../TicketActions.tsx";
import type { TicketActing } from "../TicketActions.tsx";
import { ButtonLink } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { OfferedAction } from "../ui/OfferedAction.tsx";
import { TicketHeader, TicketTabs } from "./TicketHeader.tsx";
import { TicketHeaderMenu } from "./TicketHeaderMenu.tsx";
import { readValue, TicketPageHeldProvider } from "./TicketPageHeld.tsx";
import type { TicketPageHeld, TicketReads } from "./TicketPageHeld.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";

export type TicketDraftDeletion = ConsoleWriting<number, DraftResponse>;

function draftDeleteWrite(
  partition: PartitionIdentity,
  ticket: number,
  text: CopyText,
): ConsoleWrite<number, DraftResponse> {
  return {
    mutationKey: consoleWriteKey(
      "draft-delete",
      partition.tenant,
      partition.project,
      ticket,
    ),
    write: (ports, version) =>
      apiDeleteDraft(ports, partition, ticket, version),
    refusal: (failure) => text(draftDeletionFailureSentence(failure)),
  };
}

/** The draft's deletion, held by the page rather than by the body that
 * presses it, so that what a press asks to be told is told while the page is
 * drawn, whatever body it draws; its refusal is drawn while `drawn` holds. */
export function useTicketDraftDeletion(
  partition: PartitionIdentity,
  ticket: number,
  drawn: boolean,
): TicketDraftDeletion {
  const text = useCopyText();
  return useConsoleWrite(draftDeleteWrite(partition, ticket, text), { drawn });
}

/** Release leading, Edit beside it, and the menu, for a reader who may write
 * the draft; the menu's Copy link alone for one who may not. */
function TicketDraftActions(props: {
  readonly partition: PartitionIdentity;
  readonly draft: DraftResponse;
  readonly acting: TicketActing;
  readonly deleting: boolean;
  readonly onDelete: () => void;
}): ReactNode {
  const { partition, draft, acting } = props;
  const writes = !projectAbilityRefused(
    useProjectAbilities(partition),
    "mutate",
  );
  const release = draftReleaseAction(draft);
  const text = useCopyText();
  const busy = acting.busy || props.deleting;
  return (
    <div className="ticket-header-actions">
      {writes ? (
        <>
          <OfferedAction
            action={release.action}
            effect={text(
              ticketActionEffect(release.action, { kind: "NoPoint" }).effect,
            )}
            busy={busy}
            primary
            onChoose={() => {
              acting.submitting.submit(release);
            }}
          />
          <ButtonLink
            to="/$tenant/$project/tickets/new"
            params={partition}
            search={{ draft: draft.ticket }}
          >
            {text({ id: "ticket-edit" })}
          </ButtonLink>
        </>
      ) : null}
      <TicketHeaderMenu
        partition={partition}
        ticket={draft.ticket}
        revoke={undefined}
        duplicate={writes}
        busy={busy}
        onChoose={acting.submitting.submit}
        onDelete={writes ? props.onDelete : undefined}
      />
    </div>
  );
}

function TicketDraftStanding(props: {
  readonly held: TicketPageHeld;
  readonly draft: DraftResponse;
  readonly acting: TicketActing;
  readonly deletion: TicketDraftDeletion;
  readonly children: ReactNode;
}): ReactNode {
  const { held, draft } = props;
  const navigate = useNavigate();
  const deleting = props.deletion;
  const text = useCopyText();
  return (
    <>
      <TicketHeader
        ticket={held.ticket}
        title={
          ticketDraftTitleOf(draft) ?? text({ id: "ticket-draft-untitled" })
        }
        standing="Draft"
        fragment={{
          fragment: "Words",
          words: text({ id: "ticket-draft-not-released" }),
        }}
        nowMs={held.nowMs}
        epics={null}
        actions={
          <TicketDraftActions
            partition={held.partition}
            draft={draft}
            acting={props.acting}
            deleting={deleting.isPending}
            onDelete={() => {
              deleting.mutate(draft.authoringVersion, {
                onSuccess: () => {
                  void navigate({
                    to: "/$tenant/$project",
                    params: held.partition,
                  });
                },
              });
            }}
          />
        }
        notes={
          <div className="ticket-header-notes">
            <FollowNotes submitting={props.acting.submitting} />
            {deleting.error === null ? null : (
              <Notice tone="danger" inline detail={deleting.error.message} />
            )}
          </div>
        }
      />
      <TicketTabs
        partition={held.partition}
        ticket={held.ticket}
        runCount={undefined}
        runCountCut={false}
        runsWithin={false}
      />
      <TicketPageHeldProvider value={held}>
        {props.children}
      </TicketPageHeldProvider>
    </>
  );
}

/** The page of a draft never released, in the layout a ticket's is drawn in. */
export function TicketDraftBody(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly draft: DraftResponse;
  readonly reads: TicketReads;
  readonly deletion: TicketDraftDeletion;
  readonly nowMs: number;
  readonly children: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const held: TicketPageHeld = {
    partition: props.partition,
    ticket: props.ticket,
    reads: props.reads,
    facts: ticketDraftPageFacts(
      props.draft,
      readValue(props.reads.configurationState)?.canonical,
      text,
    ),
    nowMs: props.nowMs,
    slot: { slot: "Nothing" },
    overrides: null,
    draft: props.draft,
  };
  return (
    <FreshnessInstants>
      <div data-fills-width className="grid min-w-0 gap-4">
        <TicketActingScope
          partition={props.partition}
          ticket={props.ticket}
          drawn
        >
          {(acting) => (
            <TicketDraftStanding
              held={held}
              draft={props.draft}
              acting={acting}
              deletion={props.deletion}
            >
              {props.children}
            </TicketDraftStanding>
          )}
        </TicketActingScope>
      </div>
    </FreshnessInstants>
  );
}
