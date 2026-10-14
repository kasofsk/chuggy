/**
 * The order "Up next" is drawn in: nearest to dispatchable first.
 *
 * The keys, in order: distance to readiness, ascending; then the least
 * advanced open dependency, nearest to Done first, because that is the one
 * gating the row; then the read's own order, newest activity first. A row
 * waiting on a revoked dependency is on no path to readiness at all, so those
 * follow every other row, in the read's order among themselves.
 *
 * THE ROWS ARE A WINDOW, NOT THE DAG. A row's distance is one more than the
 * deepest of its open dependencies this window holds, and a dependency it does
 * not hold counts as ready, because the rows are bounded pages of one filter's
 * read and what lies beyond them is not known here. So the order is exact
 * within the window and says nothing about the DAG outside it.
 */

import type { TicketPhase } from "../../../../src/contract/rosters.ts";

export interface UpNextOpenDependency {
  readonly ticket: number;
  readonly phase: TicketPhase;
}

export interface UpNextRow {
  readonly ticket: number;
  readonly openDependencies: readonly UpNextOpenDependency[];
  readonly revokedDependencies: readonly number[];
}

/** How far a phase is from Done, so a lower rank is nearer. Written out rather
 * than read off `phaseRoster`, which lists Escalated and Revoked after Done, so
 * a phase the roster gains is a compile error here until it is ranked. */
export function upNextPhaseRank(phase: TicketPhase): number {
  switch (phase) {
    case "Done":
      return 0;
    case "Finalization":
      return 1;
    case "Evaluation":
      return 2;
    case "Work":
      return 3;
    case "Escalated":
      return 4;
    case "Pending":
      return 5;
    case "Revoked":
      return 6;
  }
}

/** The rank of what gates the row: its least advanced open dependency, and
 * Done's where it waits on nothing. */
function upNextOrderedGateRank(row: UpNextRow): number {
  return Math.max(
    upNextPhaseRank("Done"),
    ...row.openDependencies.map((dependency) =>
      upNextPhaseRank(dependency.phase),
    ),
  );
}

/**
 * Every row's distance to readiness. A dependency already on the walk's path
 * counts as ready, which is what ends a walk over a window that appears to hold
 * a cycle; the path never holds a row twice, so no walk is deeper than the
 * window is long.
 */
function upNextOrderedDistances<Row extends UpNextRow>(
  rows: readonly Row[],
): ReadonlyMap<number, number> {
  const held = new Map(rows.map((row) => [row.ticket, row]));
  const distances = new Map<number, number>();
  const path = new Set<number>();
  const distanceOf = (row: UpNextRow): number => {
    const known = distances.get(row.ticket);
    if (known !== undefined) return known;
    if (row.openDependencies.length === 0) return 0;
    path.add(row.ticket);
    if (path.size > held.size) throw new Error("walk outran the window");
    const deepest = Math.max(
      0,
      ...row.openDependencies.map((dependency) => {
        const dependencyRow = held.get(dependency.ticket);
        return dependencyRow === undefined || path.has(dependency.ticket)
          ? 0
          : distanceOf(dependencyRow);
      }),
    );
    path.delete(row.ticket);
    distances.set(row.ticket, deepest + 1);
    return deepest + 1;
  };
  for (const row of rows) distances.set(row.ticket, distanceOf(row));
  return distances;
}

/** The rows of "Up next" nearest to dispatchable first, ties kept in the order
 * they came in, which is the read's own. */
export function upNextOrdered<Row extends UpNextRow>(
  rows: readonly Row[],
): readonly Row[] {
  const distances = upNextOrderedDistances(rows);
  const keyed = rows.map((row) =>
    row.revokedDependencies.length > 0
      ? { row, revoked: 1, distance: 0, gate: 0 }
      : {
          row,
          revoked: 0,
          distance: distances.get(row.ticket) ?? 0,
          gate: upNextOrderedGateRank(row),
        },
  );
  keyed.sort(
    (left, right) =>
      left.revoked - right.revoked ||
      left.distance - right.distance ||
      left.gate - right.gate,
  );
  return keyed.map((one) => one.row);
}
