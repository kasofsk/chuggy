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

import type { RepositoryConfigurationRow } from "../../core/repositoryConfigurations.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Table } from "../ui/Table.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";

function RepositoryConfigurationFacts(props: {
  readonly row: RepositoryConfigurationRow;
}): ReactNode {
  const facts = props.row.facts;
  if (facts === undefined)
    return (
      <td colSpan={4}>
        <Pill tone="neutral">Incomplete</Pill>
      </td>
    );
  return (
    <>
      <td>
        <Tooltip text={facts.worker.title}>
          <span>{facts.worker.text}</span>
        </Tooltip>
      </td>
      <td className="tabular-nums">{facts.stages}</td>
      <td>{facts.approval}</td>
      <td>{facts.handoff}</td>
    </>
  );
}

/** What the budget left unread, which is a fact about the table, not a row. */
function RepositoryConfigurationsPartial(): ReactNode {
  return <p className="text-ink-3 text-sm">Not every configuration was read</p>;
}

export function RepositoryConfigurationTable(props: {
  readonly rows: readonly RepositoryConfigurationRow[];
  readonly partial: boolean;
}): ReactNode {
  if (props.rows.length === 0)
    return props.partial ? (
      <RepositoryConfigurationsPartial />
    ) : (
      <EmptyState label="No configuration declared" />
    );
  return (
    <>
      <Table caption="Declared configurations">
        <thead>
          <tr>
            <th scope="col">Configuration</th>
            <th scope="col">Worker</th>
            <th scope="col">Stages</th>
            <th scope="col">Approval</th>
            <th scope="col">Handoff</th>
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
