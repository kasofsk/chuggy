/**
 * How a finished ticket in this repository lands, and the write that moves it,
 * which the binding's other settings write through as well.
 *
 * A WRITE A SETTING MOVED UNDER IS NOT RETRIED. The route answers `409` with
 * the binding as it stands; the section says so and stops, and the draft takes
 * that binding so the next Save fences against it rather than against what
 * this page read before somebody else wrote.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ProjectRepositoryResponse } from "../../../../../src/contract/responses.ts";
import { briefFinalizationModes } from "../../../../../src/contract/rosters.ts";
import { apiWriteProjectRepositoryLanding } from "../../core/apiRoutes.ts";
import { landingEffect, landingLabel } from "../../core/codeLabels.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import {
  projectRepositoriesInvalidated,
  projectRepositoriesQuery,
  projectRepositoriesReachUnaskedQuery,
} from "../../core/projectQueries.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import {
  projectRepositoriesWith,
  repositoryLandingChosen,
  repositoryLandingDraft,
  repositoryLandingMoved,
  repositoryLandingRebased,
  repositoryLandingRefusal,
  repositoryLandingRestored,
  repositoryLandingSavable,
  repositoryLandingWrite,
} from "../../core/repositoryLanding.ts";
import type { RepositoryLandingDraft } from "../../core/repositoryLanding.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { Notice } from "../ui/Notice.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { SettingsSection } from "../ui/SettingsSection.tsx";

const landingOptions = briefFinalizationModes.map((mode) => ({
  value: mode,
  text: landingLabel(mode),
  description: landingEffect(mode),
}));

/** What the last write did, in the one line the section says it in. */
function RepositoryLandingNotice(props: {
  readonly saving: ConsoleWriting<
    RepositoryLandingDraft,
    ProjectRepositoryResponse
  >;
}): ReactNode {
  const saving = props.saving;
  if (saving.isPending) return <Notice tone="info" inline detail="Writing" />;
  if (saving.error !== null)
    return (
      <Notice
        tone={
          repositoryLandingMoved(saving.error.failure) === undefined
            ? "danger"
            : "parked"
        }
        inline
        detail={saving.error.message}
      />
    );
  if (saving.isSuccess) return <Notice tone="live" inline detail="Written" />;
  return null;
}

interface RepositoryLandingHeld {
  readonly draft: RepositoryLandingDraft;
  readonly setDraft: (draft: RepositoryLandingDraft) => void;
}

/** The draft, seeded from the binding and rebased when THE BINDING moves — not
 * when the draft and the binding merely differ, which is what an open edit is. */
function useRepositoryLandingDraft(
  binding: ProjectRepositoryResponse,
): RepositoryLandingHeld {
  const [draft, setDraft] = useState<RepositoryLandingDraft>(() =>
    repositoryLandingDraft(binding),
  );
  const standing = `${binding.landing.mode}/${String(binding.pipelinesWritable)}`;
  const [seen, setSeen] = useState(standing);
  if (seen !== standing) {
    setSeen(standing);
    const rebased = repositoryLandingRebased(draft, binding);
    setDraft(rebased);
    return { draft: rebased, setDraft };
  }
  return { draft, setDraft };
}

/**
 * The one door the binding's settings write through, one section's under a key
 * of its own. A write that landed IS the newest read of its row, so it is
 * written into the bindings the page holds, and the read with reach is read
 * again, rather than left for a refetch nothing schedules: the route raises no
 * frame.
 */
function repositorySettingWrite(
  partition: PartitionIdentity,
  repository: string,
  title: string,
): ConsoleWrite<RepositoryLandingDraft, ProjectRepositoryResponse> {
  return {
    mutationKey: consoleWriteKey(
      "repository-setting",
      partition.tenant,
      partition.project,
      repository,
      title,
    ),
    write: (ports, draft) =>
      apiWriteProjectRepositoryLanding(
        ports,
        partition,
        repositoryLandingWrite(draft, repository),
      ),
    refusal: repositoryLandingRefusal,
    landed: async (client, binding) => {
      client.setQueryData(
        projectRepositoriesReachUnaskedQuery(partition).queryKey,
        (bindings) =>
          bindings === undefined
            ? bindings
            : projectRepositoriesWith(bindings, binding),
      );
      await client.invalidateQueries({
        queryKey: projectRepositoriesQuery(partition).queryKey,
      });
    },
  };
}

/**
 * One of the binding's settings as a section, read until its Edit is pressed.
 * Each section holds a draft of every setting and moves only its own, so its
 * write carries the others as this page read them.
 */
export function RepositorySettingSection(props: {
  readonly partition: PartitionIdentity;
  readonly binding: ProjectRepositoryResponse;
  readonly title: string;
  readonly about: string;
  /** The section's own control, over the draft it moves. */
  readonly body: (held: RepositoryLandingHeld, editing: boolean) => ReactNode;
}): ReactNode {
  const held = useRepositoryLandingDraft(props.binding);
  const client = useQueryClient();
  const saving = useConsoleWrite(
    repositorySettingWrite(
      props.partition,
      props.binding.repository,
      props.title,
    ),
    { drawn: true },
  );
  const [editing, setEditing] = useState(false);
  const abilities = useProjectAbilities(props.partition);
  const shown = saving.isPending || saving.error !== null || saving.isSuccess;
  const moved = repositoryLandingMoved(saving.error?.failure);
  return (
    <SettingsSection
      title={props.title}
      about={props.about}
      editing={editing}
      editable
      readOnly={projectAbilityRefused(abilities, "administer")}
      savable={repositoryLandingSavable(held.draft) && !saving.isPending}
      footLead={null}
      {...(shown
        ? { notice: <RepositoryLandingNotice saving={saving} /> }
        : {})}
      {...(moved === undefined
        ? {}
        : {
            onReload: () => {
              void projectRepositoriesInvalidated(client, props.partition);
            },
          })}
      onEdit={() => {
        setEditing(true);
      }}
      onCancel={() => {
        held.setDraft(repositoryLandingRestored(held.draft));
        setEditing(false);
      }}
      onSave={() => {
        const draft = held.draft;
        saving.mutate(draft, {
          onSuccess: () => {
            setEditing(false);
          },
          onError: (refused) => {
            const standing = repositoryLandingMoved(refused.failure);
            if (standing !== undefined)
              held.setDraft(repositoryLandingRebased(draft, standing));
          },
        });
      }}
    >
      {props.body(held, editing)}
    </SettingsSection>
  );
}

export function RepositoryLandingSection(props: {
  readonly partition: PartitionIdentity;
  readonly binding: ProjectRepositoryResponse;
}): ReactNode {
  return (
    <RepositorySettingSection
      partition={props.partition}
      binding={props.binding}
      title="Landing"
      about="How a finished ticket lands. A ticket may choose otherwise."
      body={(held, editing) => (
        <RadioGroup
          label="Landing"
          value={held.draft.mode}
          disabled={!editing}
          options={landingOptions}
          onChoose={(value) => {
            const chosen = briefFinalizationModes.find(
              (mode) => mode === value,
            );
            if (chosen !== undefined)
              held.setDraft(repositoryLandingChosen(held.draft, chosen));
          }}
        />
      )}
    />
  );
}
