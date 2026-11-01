/**
 * A repository's last configuration import, and Import now.
 *
 * The route keeps every attempt it makes, a refused one included, so whatever
 * it answers the listing is read again and the line is drawn from that; the
 * button stays working until it has been. A refusal the line does not already
 * draw as no fault is said under it, and a refused import names the file it
 * was refused for under it too.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { RepositoryConfigurationImportAttemptResponse } from "../../../../../src/contract/responses.ts";
import { apiImportRepositoryConfigurations } from "../../core/apiRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { agoFigure } from "../../core/figures.ts";
import {
  projectRepositoriesInvalidated,
  projectRepositoriesReachUnaskedQuery,
} from "../../core/projectQueries.ts";
import {
  repositoryImportLabel,
  repositoryImportLine,
  repositoryImportNote,
  repositoryImportPress,
  repositoryImportRefused,
  repositoryImportRefusedFile,
} from "../../core/repositoryImport.ts";
import { projectRepositoryBound } from "../../core/repositoryLanding.ts";
import { repositoryImportTone } from "../../core/tones.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { useNowMs } from "../Freshness.tsx";
import { Button } from "../ui/Button.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";

/** One Import now: whether its request is out, and the line its refusal left. */
export interface RepositoryImporting {
  readonly busy: boolean;
  readonly refused: string | undefined;
  readonly importNow: () => void;
}

/** The instant of the attempt the line drew when Import now was pressed. */
interface RepositoryImportOver {
  readonly over: string | undefined;
}

/**
 * One Import now, over once the listing has been read again whatever the route
 * answered, because it keeps a refused attempt too. A refusal is one only where
 * the line read again does not already draw it as no fault.
 */
function repositoryImportWrite(
  partition: PartitionIdentity,
  repository: string,
): ConsoleWrite<RepositoryImportOver, undefined> {
  return {
    mutationKey: consoleWriteKey(
      "repository-import",
      partition.tenant,
      partition.project,
      repository,
    ),
    write: async (ports, pressed, client) => {
      const answered = await apiImportRepositoryConfigurations(
        ports,
        partition,
        { repository },
      );
      await projectRepositoriesInvalidated(client, partition);
      const held = client.getQueryData(
        projectRepositoriesReachUnaskedQuery(partition).queryKey,
      );
      const line = repositoryImportLine(
        held === undefined
          ? undefined
          : projectRepositoryBound(held, repository)?.lastImport,
      );
      const note = repositoryImportNote({ answered, over: pressed.over }, line);
      if (answered.outcome !== "Ok" && note !== undefined) return answered;
      return { outcome: "Ok", value: undefined };
    },
    refusal: repositoryImportRefused,
  };
}

/** `over` is the instant of the attempt the line draws, which a press is made over. */
export function useRepositoryImportNow(
  partition: PartitionIdentity,
  repository: string,
  over: string | undefined,
): RepositoryImporting {
  const importing = useConsoleWrite(
    repositoryImportWrite(partition, repository),
  );
  return {
    busy: importing.isPending,
    refused: importing.error?.message,
    importNow: () => {
      importing.mutate({ over });
    },
  };
}

export function RepositoryImportButton(props: {
  readonly importing: RepositoryImporting;
}): ReactNode {
  const busy = props.importing.busy;
  return (
    <Button
      size="sm"
      variant="quiet"
      busy={busy}
      disabled={busy}
      onClick={props.importing.importNow}
    >
      {busy ? repositoryImportPress.busy : repositoryImportPress.idle}
    </Button>
  );
}

export function RepositoryImportLine(props: {
  readonly lastImport: RepositoryConfigurationImportAttemptResponse | undefined;
  readonly refused: string | undefined;
}): ReactNode {
  const nowMs = useNowMs();
  const line = repositoryImportLine(props.lastImport);
  const refusal = repositoryImportRefusedFile(props.lastImport);
  return (
    <div className="grid gap-1">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-3">{repositoryImportLabel}</span>
        <Pill tone={repositoryImportTone(line.word)}>{line.word}</Pill>
        {"attemptedAt" in line ? (
          <Figure figure={agoFigure(line.attemptedAt, nowMs)} />
        ) : null}
        {"commit" in line && line.commit !== undefined ? (
          <Identity label={line.commit} />
        ) : null}
      </p>
      {refusal === undefined ? null : (
        <p className="text-sm text-ink-2">{refusal}</p>
      )}
      {props.refused === undefined ? null : (
        <Notice tone="danger" inline role="status" detail={props.refused} />
      )}
    </div>
  );
}
