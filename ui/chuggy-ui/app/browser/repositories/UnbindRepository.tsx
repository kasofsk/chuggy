/**
 * Unbinding one repository: the press on its row, the question asked under the
 * listing before anything is sent, and the listing read again once the route
 * has retired the binding, the question standing busy until it is.
 *
 * THE QUESTION IS DRAWN UNDER THE TABLE AND NOT IN IT, because a table wider
 * than a phone scrolls itself, and a question inside the scroller is cut by
 * it. It names the repository, so it needs no row beside it to say which.
 *
 * A REFUSAL IS SAID UNDER THE QUESTION IT ANSWERED, which stays drawn until
 * the reader cancels it or presses again, and the binding's row is left as it
 * was.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ProjectRepositoryResponse } from "../../../../../src/contract/responses.ts";
import { apiRetireProjectRepository } from "../../core/apiRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { projectRepositoriesInvalidated } from "../../core/projectQueries.ts";
import {
  repositoryUnbindNote,
  repositoryUnbindQuestion,
} from "../../core/projectRepositories.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { Notice } from "../ui/Notice.tsx";

/** One unbind at a time across the listing, from its press to its answer. */
export interface RepositoryUnbinding {
  /** The repository whose question is drawn. */
  readonly asking: string | undefined;
  readonly busy: boolean;
  /** The word the last refusal of the asked unbind is drawn as. */
  readonly note: string | undefined;
  readonly press: (repository: string) => void;
  readonly cancel: () => void;
  readonly send: (repository: string) => void;
}

/** One unbind, over only once the listing it retired a row of has been read
 * again. */
function repositoryUnbindWrite(
  partition: PartitionIdentity,
): ConsoleWrite<string, ProjectRepositoryResponse> {
  return {
    mutationKey: consoleWriteKey(
      "repository-unbind",
      partition.tenant,
      partition.project,
    ),
    write: (ports, repository) =>
      apiRetireProjectRepository(ports, partition, { repository }),
    refusal: repositoryUnbindNote,
    landed: (client) => projectRepositoriesInvalidated(client, partition),
  };
}

export function useRepositoryUnbinding(
  partition: PartitionIdentity,
): RepositoryUnbinding {
  const unbinding = useConsoleWrite(repositoryUnbindWrite(partition));
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const asked = (repository: string | undefined): void => {
    unbinding.reset();
    setAsking(repository);
  };
  return {
    asking,
    busy: unbinding.isPending,
    note: unbinding.error?.message,
    press: asked,
    cancel: () => {
      asked(undefined);
    },
    send: (repository) => {
      unbinding.mutate(repository, {
        onSuccess: () => {
          setAsking(undefined);
        },
      });
    },
  };
}

/** Unbind on a live binding's row, held while any question is drawn. */
export function UnbindPress(props: {
  readonly repository: string;
  readonly unbinding: RepositoryUnbinding;
}): ReactNode {
  const unbinding = props.unbinding;
  return (
    <Button
      variant="quiet"
      size="sm"
      disabled={unbinding.busy || unbinding.asking !== undefined}
      onClick={() => {
        unbinding.press(props.repository);
      }}
    >
      Unbind
    </Button>
  );
}

/** The unbind asked, if one is: the question, and under it the word a
 * refusal of it was drawn as. */
export function UnbindAsked(props: {
  readonly unbinding: RepositoryUnbinding;
}): ReactNode {
  const unbinding = props.unbinding;
  const repository = unbinding.asking;
  if (repository === undefined) return null;
  const asked = repositoryUnbindQuestion(repository);
  return (
    <div className="ms-auto grid w-full max-w-aside gap-2">
      <Confirm
        question={asked.question}
        confirm="Unbind"
        busy={unbinding.busy}
        onConfirm={() => {
          unbinding.send(repository);
        }}
        onCancel={unbinding.cancel}
      >
        {asked.line}
      </Confirm>
      {unbinding.note === undefined ? null : (
        <Notice tone="danger" inline role="status" detail={unbinding.note} />
      )}
    </div>
  );
}
