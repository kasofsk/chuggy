/**
 * What a repository declares, one row per configuration name: what it runs the
 * work on, how many stages judge it, and what finalizing it takes.
 *
 * A revision that is not ready decides none of those yet, so the row says that
 * where its worker would be and draws nothing a reader would read as an
 * answer. On a narrow container each configuration is a card. A walk the
 * page budget cut short says so under the rows, because the ones it did not
 * reach are otherwise indistinguishable from ones that do not exist.
 */

import type { ReactNode } from "react";

import { copyOrDataText } from "../../core/copy.ts";
import type { CopyText } from "../../core/copy.ts";
import { configurationsPartialLabel } from "../../core/repositoryConfigurations.ts";
import type { RepositoryConfigurationRow } from "../../core/repositoryConfigurations.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { StatusBadge } from "../ui/StatusBadge.tsx";
import { Table } from "../ui/Table.tsx";
import type { TableRow } from "../ui/Table.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";

type RepositoryConfigurationColumn = "configuration" | "worker" | "stages";

/** A row's cells: the facts, or where the revision is not ready, that word
 * under the worker and nothing under the stages it decides with it. */
function repositoryConfigurationCells(
  row: RepositoryConfigurationRow,
  text: CopyText,
): TableRow<RepositoryConfigurationColumn>["cells"] {
  const name = (
    <Tooltip trigger="abbreviation" text={row.configuration.title}>
      <span>{row.configuration.text}</span>
    </Tooltip>
  );
  const facts = row.facts;
  if (facts === undefined)
    return {
      configuration: name,
      worker: (
        <StatusBadge tone="neutral" size="small">
          {text({ id: "repositories-incomplete" })}
        </StatusBadge>
      ),
      stages: null,
    };
  return {
    configuration: name,
    worker: (
      <Tooltip trigger="abbreviation" text={facts.worker.title}>
        <span>{copyOrDataText(text, facts.worker.text)}</span>
      </Tooltip>
    ),
    stages: facts.stages,
  };
}

/** What the budget left unread, which is a fact about the table, not a row. */
function RepositoryConfigurationsPartial(): ReactNode {
  const text = useCopyText();
  return (
    <p className="text-ink-3 text-sm">{text(configurationsPartialLabel)}</p>
  );
}

export function RepositoryConfigurationTable(props: {
  readonly rows: readonly RepositoryConfigurationRow[];
  readonly partial: boolean;
}): ReactNode {
  const text = useCopyText();
  if (props.rows.length === 0)
    return props.partial ? (
      <RepositoryConfigurationsPartial />
    ) : (
      <EmptyState label={text({ id: "repositories-configurations-none" })} />
    );
  return (
    <>
      <Table
        caption={text({ id: "repositories-configurations-caption" })}
        stacked={{
          columns: [
            {
              key: "configuration",
              label: text({ id: "repositories-col-configuration" }),
              rowHeader: true,
            },
            { key: "worker", label: text({ id: "repositories-col-worker" }) },
            {
              key: "stages",
              label: text({ id: "repositories-col-stages" }),
              numeric: true,
            },
          ],
          rows: props.rows.map((row) => ({
            key: row.revision,
            cells: repositoryConfigurationCells(row, text),
          })),
        }}
      />
      {props.partial ? <RepositoryConfigurationsPartial /> : null}
    </>
  );
}
