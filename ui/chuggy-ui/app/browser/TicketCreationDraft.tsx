/**
 * A new ticket written on a draft the project already holds: the creation
 * screen opened on the draft the address names, following it as it is
 * revised, and releasing that same draft on submit rather than creating
 * another.
 *
 * The draft reads into the form as a duplicate's does, its dependencies
 * carried for the release to judge, and it is the held draft a creation's
 * submit goes back to, so a submit revises that draft and releases it. A
 * draft already released or deleted as the screen opens is said in place of
 * the form, there being nothing left of it to release. The YAML it keeps is
 * kept where an edit of the same draft keeps its own. Edits the draft does
 * not hold are saved to it before the reader's thread is sent a message.
 */

import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type {
  DraftResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import {
  draftFollowClosedOf,
  draftFollowNewest,
  draftFollowSaveable,
} from "../core/draftFollow.ts";
import {
  creationBodyFrom,
  creationFormProposed,
  creationRepositories,
} from "../core/ticketCreation.ts";
import type {
  CreationFault,
  TicketCreationForm,
} from "../core/ticketCreation.ts";
import {
  ticketDuplicateDroppedSentence,
  ticketDuplicateSeed,
} from "../core/ticketDuplicate.ts";
import type { TicketDuplicateSeed } from "../core/ticketDuplicate.ts";
import { creationRevisionAt } from "../core/ticketCreationRun.ts";
import { draftQuery } from "../core/ticketQueries.ts";
import { usePanelState } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import {
  ticketConfigurationStored,
  ticketYamlStoreKey,
} from "./editor/authoringGuards.tsx";
import {
  DraftClosedNotice,
  DraftFollowNotice,
  useDraftFollow,
} from "./editor/DraftFollow.tsx";
import {
  draftSaveAttempt,
  useDraftSaveOffered,
} from "./editor/draftSaveBeforeSend.tsx";
import type {
  DraftSaveOffer,
  DraftSaving,
} from "./editor/draftSaveBeforeSend.tsx";
import type { DraftFollowing } from "./editor/DraftFollow.tsx";
import {
  CreationFormDrawn,
  CreationScreen,
  creationChoiceKept,
  useCreationFormSubmit,
} from "./TicketCreation.tsx";
import type {
  CreationFormProps,
  CreationScreenReady,
} from "./TicketCreation.tsx";
import { Notice } from "./ui/Notice.tsx";

interface DraftFormProps extends CreationFormProps {
  readonly current: DraftResponse;
}

/** The form a revision of the draft reads as, decided by the project's offers
 * and the configuration this reader last chose here. */
function useDraftFormOf(
  props: DraftFormProps,
): (draft: DraftResponse) => TicketDuplicateSeed {
  const { offers, partial, repositories } = props.context;
  const [preferred] = useState(() =>
    ticketConfigurationStored(props.partition),
  );
  return useCallback(
    (draft: DraftResponse) =>
      ticketDuplicateSeed({
        draft,
        offers,
        bound: repositories,
        revoked: [],
        preferred,
        partial,
      }),
    [offers, repositories, preferred, partial],
  );
}

/** The save the form offers its reader's thread while it holds edits: the
 * whole of what it would revise the draft to, at the version it stands on. */
function useCreationDraftSaving(
  props: DraftFormProps,
  repositories: readonly ProjectRepositoryResponse[],
  follow: DraftFollowing<TicketCreationForm>,
  held: Pick<DraftSaveOffer, "onFaults" | "onSaved"> & {
    readonly busy: boolean;
  },
): DraftSaving {
  const standing = props.standing ?? { mayOverride: true };
  return useDraftSaveOffered({
    ports: props.ports,
    partition: props.partition,
    ticket: props.current.ticket,
    offered:
      follow.edited && !held.busy && draftFollowSaveable(follow.standing),
    assemble: () => {
      const assembled = creationBodyFrom(
        props.context.offers,
        creationFormProposed(follow.form),
        repositories,
        standing,
      );
      return assembled.assembled === "Faults"
        ? assembled
        : {
            assembled: "Body",
            revision: creationRevisionAt(assembled.body, follow.version),
          };
    },
    onFaults: held.onFaults,
    onSaved: held.onSaved,
  });
}

/** The form over the draft, following it as it is revised. */
function CreationDraftForm(props: DraftFormProps): ReactNode {
  const [faults, setFaults] = useState<readonly CreationFault[]>([]);
  const bound = props.context.repositories;
  const repositories = useMemo(() => creationRepositories(bound), [bound]);
  const storeKey = ticketYamlStoreKey(props.partition, props.current.ticket);
  const running = useCreationFormSubmit(
    props,
    repositories,
    storeKey,
    setFaults,
  );
  const seedOf = useDraftFormOf(props);
  const formOf = useCallback(
    (draft: DraftResponse): TicketCreationForm => seedOf(draft).form,
    [seedOf],
  );
  const [saved, setSaved] = useState<DraftResponse>();
  const follow = useDraftFollow({
    current: props.current,
    own: draftFollowNewest(running.held?.draft, saved),
    busy: running.busy,
    formOf,
    storeKey,
  });
  const saving = useCreationDraftSaving(props, repositories, follow, {
    busy: running.busy,
    onFaults: setFaults,
    onSaved: setSaved,
  });
  const dropped = ticketDuplicateDroppedSentence(seedOf(follow.base).dropped);
  const onto = { base: follow.base, version: follow.version };
  return (
    <CreationFormDrawn
      {...props}
      repositories={repositories}
      storeKey={storeKey}
      faults={faults}
      held={{
        initial: follow.initial,
        form: follow.form,
        changed: creationChoiceKept(
          props.partition,
          follow.form,
          follow.changed,
        ),
      }}
      attempt={draftSaveAttempt(saving.refusal, running.attempt)}
      busy={running.busy}
      onSubmit={(form) => {
        saving.cleared();
        running.submit(form, onto);
      }}
      following={follow.authoring}
      lead={
        <>
          {dropped === undefined ? null : (
            <Notice tone="info" detail={dropped} />
          )}
          <DraftFollowNotice
            standing={follow.standing}
            onTaken={follow.taken}
            onKept={follow.kept}
            released={props.existing}
          />
        </>
      }
    />
  );
}

/** The draft as the screen opened on it: the form where it is one still, and
 * otherwise what became of it. */
function CreationDraftOpened(
  props: CreationScreenReady & { readonly current: DraftResponse },
): ReactNode {
  const [closed] = useState(() => draftFollowClosedOf(props.current));
  if (closed === undefined) return <CreationDraftForm {...props} />;
  return <DraftClosedNotice closed={closed} released={props.existing} />;
}

function CreationDraftRead(
  props: CreationScreenReady & { readonly ticket: number },
): ReactNode {
  const { partition, ticket } = props;
  const state = usePanelState(draftQuery(partition, ticket, "Streamed"));
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  return <CreationDraftOpened {...props} current={state.value} />;
}

export function TicketCreationDraft(props: {
  readonly draft: number;
}): ReactNode {
  return (
    <CreationScreen heading={<>Draft {props.draft}</>}>
      {(ready) => <CreationDraftRead {...ready} ticket={props.draft} />}
    </CreationScreen>
  );
}
