/**
 * A repository's last configuration import, and Import now.
 *
 * The route keeps every attempt it makes, a refused one included, so whatever
 * it answers the listing is read again and the line is drawn from that; the
 * button stays working until it has been. A refusal the line does not already
 * draw as no fault is said under it, and a refused import names the file it
 * was refused for under it too.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { RepositoryConfigurationImportAttemptResponse } from "../../../../../src/contract/responses.ts";
import { apiImportRepositoryConfigurations } from "../../core/apiRoutes.ts";
import { agoFigure } from "../../core/figures.ts";
import {
  repositoryImportLabel,
  repositoryImportLine,
  repositoryImportNote,
  repositoryImportPress,
  repositoryImportRefusedFile,
  type RepositoryImportPressed,
} from "../../core/repositoryImport.ts";
import { repositoryImportTone } from "../../core/tones.ts";
import { useApiPorts } from "../api.ts";
import { useNowMs } from "../Freshness.tsx";
import { Button } from "../ui/Button.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";
import { projectRepositoriesInvalidated } from "./AddRepository.tsx";

/** One Import now: whether its request is out, and how the last one was answered. */
export interface RepositoryImporting {
  readonly busy: boolean;
  readonly pressed: RepositoryImportPressed | undefined;
  readonly importNow: () => void;
}

/** `over` is the instant of the attempt the line draws, which a press is made over. */
export function useRepositoryImportNow(
  partition: PartitionIdentity,
  repository: string,
  over: string | undefined,
): RepositoryImporting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [pressed, setPressed] = useState<RepositoryImportPressed | undefined>(
    undefined,
  );
  return {
    busy,
    pressed,
    importNow: () => {
      setBusy(true);
      setPressed(undefined);
      void (async () => {
        const answered = await apiImportRepositoryConfigurations(
          ports,
          partition,
          { repository },
        );
        await projectRepositoriesInvalidated(client, partition);
        setBusy(false);
        setPressed({ answered, over });
      })();
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
  readonly pressed: RepositoryImportPressed | undefined;
}): ReactNode {
  const nowMs = useNowMs();
  const line = repositoryImportLine(props.lastImport);
  const note = repositoryImportNote(props.pressed, line);
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
      {note === undefined ? null : (
        <Notice
          tone="danger"
          inline
          role="status"
          detail={`Not imported · ${note}`}
        />
      )}
    </div>
  );
}
