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
import type {
  ProjectRepositoriesResponse,
  ProjectRepositoryResponse,
} from "../../../../../src/contract/responses.ts";
import { briefFinalizationModes } from "../../../../../src/contract/rosters.ts";
import { apiWriteProjectRepositoryLanding } from "../../core/apiRoutes.ts";
import { landingEffect, landingLabel } from "../../core/codeLabels.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import { projectResourceKey } from "../../core/projectQueryKeys.ts";
import {
  projectRepositoriesWith,
  repositoryLandingAnswered,
  repositoryLandingChosen,
  repositoryLandingDraft,
  repositoryLandingRebased,
  repositoryLandingRestored,
  repositoryLandingSavable,
  repositoryLandingWrite,
} from "../../core/repositoryLanding.ts";
import type {
  RepositoryLandingDraft,
  RepositoryLandingSaved,
} from "../../core/repositoryLanding.ts";
import { useApiPorts } from "../api.ts";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { Notice } from "../ui/Notice.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { SettingsSection } from "../ui/SettingsSection.tsx";
import { projectRepositoriesResource } from "./AddRepository.tsx";

const landingOptions = briefFinalizationModes.map((mode) => ({
  value: mode,
  text: landingLabel(mode),
  description: landingEffect(mode),
}));

/** What the last write did, in the one line the section says it in. */
function RepositoryLandingNotice(props: {
  readonly saved: RepositoryLandingSaved;
}): ReactNode {
  const saved = props.saved;
  switch (saved.saved) {
    case "Idle":
      return null;
    case "Writing":
      return <Notice tone="info" inline detail="Writing" />;
    case "Written":
      return <Notice tone="live" inline detail="Written" />;
    case "Conflict":
      return <Notice tone="parked" inline detail="Settings moved" />;
    case "Failed":
      return (
        <Notice tone="danger" inline detail={`Failed · ${saved.reason}`} />
      );
  }
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

interface RepositoryLandingWriting {
  readonly saved: RepositoryLandingSaved;
  readonly write: (wrote: () => void) => void;
  readonly reload: () => void;
}

/**
 * The one door the binding's settings write through. A write that landed IS the newest
 * read of its row, so it is written into the bindings the page holds rather
 * than left for a refetch nothing schedules: the route raises no frame.
 */
function useRepositoryLandingWriting(
  partition: PartitionIdentity,
  repository: string,
  held: RepositoryLandingHeld,
): RepositoryLandingWriting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [saved, setSaved] = useState<RepositoryLandingSaved>({ saved: "Idle" });
  const key = projectResourceKey(
    partition,
    "Project",
    projectRepositoriesResource,
  );
  return {
    saved,
    reload: () => {
      void client.invalidateQueries({ queryKey: key });
    },
    write: (wrote) => {
      setSaved({ saved: "Writing" });
      void (async () => {
        const answered = repositoryLandingAnswered(
          await apiWriteProjectRepositoryLanding(
            ports,
            partition,
            repositoryLandingWrite(held.draft, repository),
          ),
        );
        setSaved(answered);
        if (answered.saved === "Written") {
          client.setQueryData(
            key,
            (bindings: ProjectRepositoriesResponse | undefined) =>
              bindings === undefined
                ? bindings
                : projectRepositoriesWith(bindings, answered.binding),
          );
          wrote();
        }
        if (answered.saved === "Conflict")
          held.setDraft(repositoryLandingRebased(held.draft, answered.binding));
      })();
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
  const writing = useRepositoryLandingWriting(
    props.partition,
    props.binding.repository,
    held,
  );
  const [editing, setEditing] = useState(false);
  const abilities = useProjectAbilities(props.partition);
  const saved = writing.saved;
  return (
    <SettingsSection
      title={props.title}
      about={props.about}
      editing={editing}
      editable
      readOnly={projectAbilityRefused(abilities, "administer")}
      savable={
        repositoryLandingSavable(held.draft) && saved.saved !== "Writing"
      }
      footLead={null}
      {...(saved.saved === "Idle"
        ? {}
        : { notice: <RepositoryLandingNotice saved={saved} /> })}
      {...(saved.saved === "Conflict" ? { onReload: writing.reload } : {})}
      onEdit={() => {
        setEditing(true);
      }}
      onCancel={() => {
        held.setDraft(repositoryLandingRestored(held.draft));
        setEditing(false);
      }}
      onSave={() => {
        writing.write(() => {
          setEditing(false);
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
