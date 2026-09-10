/**
 * The project access the durable suites run against: the grants a case makes,
 * held in memory.
 *
 * THE AUTHORITY IS NOT A PARAMETER. `memberAuthority` derives it from the
 * principal exactly as the deployed adapter does, so a case asserting what a
 * row was audited to is asserting that derivation rather than its own fixture.
 *
 * IT CAN BE BROKEN ON PURPOSE, because an authority that cannot answer is a
 * fault every caller has to carry and a suite has no other way to produce one.
 */

import {
  memberAuthority,
  ProjectAccessUnavailable,
  projectAccessObject,
  type ProjectAccess,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import type { Principal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";

/** One principal's standing in one project, as a case grants and withdraws it. */
export interface MemoryProjectGrant {
  readonly partition: Partition;
  readonly principal: Principal;
}

export interface MemoryProjectAccess extends ProjectAccess {
  /** Admits one principal to one project for the kinds named, replacing what they held. */
  grant(
    input: MemoryProjectGrant & {
      readonly access: ReadonlySet<ProjectAccessKind>;
    },
  ): void;

  /** Withdraws every kind, answering whether there was anything to withdraw. */
  revoke(input: MemoryProjectGrant): boolean;

  /** Answers every later question with the fault the adapter raises. */
  breaks(why?: string): void;

  /** Answers questions again. */
  mends(): void;
}

export function memoryProjectAccess(): MemoryProjectAccess {
  const held = new Map<string, ReadonlySet<ProjectAccessKind>>();
  let broken: string | undefined;
  const at = (grant: MemoryProjectGrant): string =>
    `${projectAccessObject(grant.partition)} ${grant.principal}`;
  return {
    authorize: (principal, partition, access) => {
      if (broken !== undefined)
        return Promise.reject(new ProjectAccessUnavailable(broken));
      const granted = held.get(at({ partition, principal }));
      return Promise.resolve(
        granted?.has(access) === true ? memberAuthority(principal) : undefined,
      );
    },
    grant: (input) => {
      held.set(at(input), new Set(input.access));
    },
    revoke: (input) => held.delete(at(input)),
    breaks: (why = "the authority did not answer") => {
      broken = why;
    },
    mends: () => {
      broken = undefined;
    },
  };
}
