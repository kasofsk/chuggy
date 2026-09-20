/**
 * How a finished ticket in this repository lands, and the write that moves it.
 *
 * A WRITE THE LANDING MOVED UNDER IS NOT RETRIED. The route answers `409` with
 * the binding as it stands; the section says so and stops, and the draft takes
 * that binding so the next Save fences against it rather than against the mode
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
import type { BriefFinalizationMode } from "../../../../../src/contract/rosters.ts";
import { apiWriteProjectRepositoryLanding } from "../../core/apiRoutes.ts";
import { landingEffect, landingLabel } from "../../core/codeLabels.ts";
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
  switch (props.saved.saved) {
    case "Idle":
      return null;
    case "Writing":
      return <Notice tone="info" inline detail="Writing" />;
    case "Written":
      return <Notice tone="live" inline detail="Written" />;
    case "Conflict":
      return <Notice tone="parked" inline detail="Landing moved" />;
    case "Failed":
      return (
        <Notice
          tone="danger"
          inline
          detail={`Failed · ${props.saved.reason}`}
        />
      );
  }
}

/**
 * The draft, seeded from the binding and rebased when the binding moves — not
 * when the draft and the binding merely differ, which is what an open edit is.
 */
function useRepositoryLandingDraft(binding: ProjectRepositoryResponse): {
  readonly draft: RepositoryLandingDraft;
  readonly setDraft: (draft: RepositoryLandingDraft) => void;
} {
  const [draft, setDraft] = useState(() => repositoryLandingDraft(binding));
  const [seen, setSeen] = useState(binding.landing.mode);
  if (seen !== binding.landing.mode) {
    const rebased = repositoryLandingRebased(draft, binding);
    setSeen(binding.landing.mode);
    setDraft(rebased);
    return { draft: rebased, setDraft };
  }
  return { draft, setDraft };
}

/**
 * The one door this section writes through. A write that landed is the newest
 * read of its row and the route raises no frame, so it is written into the
 * bindings the page holds rather than left for a refetch nothing schedules.
 */
function useRepositoryLandingWriting(
  partition: PartitionIdentity,
  repository: string,
  held: {
    readonly draft: RepositoryLandingDraft;
    readonly setDraft: (draft: RepositoryLandingDraft) => void;
  },
): {
  readonly saved: RepositoryLandingSaved;
  readonly reload: () => void;
  readonly write: (wrote: () => void) => void;
} {
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
          client.setQueryData<ProjectRepositoriesResponse>(key, (bindings) =>
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

export function RepositoryLandingSection(props: {
  readonly partition: PartitionIdentity;
  readonly binding: ProjectRepositoryResponse;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const held = useRepositoryLandingDraft(props.binding);
  const writing = useRepositoryLandingWriting(
    props.partition,
    props.binding.repository,
    held,
  );
  const saved = writing.saved;
  return (
    <SettingsSection
      title="Landing"
      about="How a finished ticket lands. A ticket may choose otherwise."
      editing={editing}
      editable
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
      <RadioGroup
        label="Landing"
        value={held.draft.mode}
        disabled={!editing}
        options={landingOptions}
        onChoose={(value) => {
          const chosen: BriefFinalizationMode | undefined =
            briefFinalizationModes.find((mode) => mode === value);
          if (chosen !== undefined)
            held.setDraft(repositoryLandingChosen(held.draft, chosen));
        }}
      />
    </SettingsSection>
  );
}
