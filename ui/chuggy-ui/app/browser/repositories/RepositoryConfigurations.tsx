/**
 * What a repository declares, one row per configuration name: what it runs the
 * work on, how many stages judge it, and what finalizing it takes.
 *
 * A revision that is not ready decides none of those yet, so the row says that
 * instead of drawing four blanks a reader would read as answers. A walk the
 * page budget cut short says so under the rows, because the ones it did not
 * reach are otherwise indistinguishable from ones that do not exist.
 */

import type { ReactNode } from "react";

import { copyOrDataText } from "../../core/copy.ts";
import { configurationsPartialLabel } from "../../core/repositoryConfigurations.ts";
import type { RepositoryConfigurationRow } from "../../core/repositoryConfigurations.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Table } from "../ui/Table.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";

function RepositoryConfigurationFacts(props: {
  readonly row: RepositoryConfigurationRow;
}): ReactNode {
  const text = useCopyText();
  const facts = props.row.facts;
  if (facts === undefined)
    return (
      <td colSpan={3}>
        <Pill tone="neutral">{text({ id: "repositories-incomplete" })}</Pill>
      </td>
    );
  return (
    <>
      <td>
        <Tooltip text={facts.worker.title}>
          <span>{copyOrDataText(text, facts.worker.text)}</span>
        </Tooltip>
      </td>
      <td className="tabular-nums">{facts.stages}</td>
      <td>{text(facts.approval)}</td>
    </>
  );
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
      <Table caption={text({ id: "repositories-configurations-caption" })}>
        <thead>
          <tr>
            <th scope="col">
              {text({ id: "repositories-col-configuration" })}
            </th>
            <th scope="col">{text({ id: "repositories-col-worker" })}</th>
            <th scope="col">{text({ id: "repositories-col-stages" })}</th>
            <th scope="col">{text({ id: "repositories-col-approval" })}</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.revision}>
              <th scope="row">
                <Tooltip text={row.configuration.title}>
                  <span>{row.configuration.text}</span>
                </Tooltip>
              </th>
              <RepositoryConfigurationFacts row={row} />
            </tr>
          ))}
        </tbody>
      </Table>
      {props.partial ? <RepositoryConfigurationsPartial /> : null}
    </>
  );
}
