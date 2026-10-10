/**
 * The next step a line about a repository offers once the project holds a
 * configuration for it, after the words that say so: a runner where the
 * project's work has none to go to, and a first ticket where it has.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { repositoryNextStep } from "../../core/projectRepositories.ts";
import type { WorkRunner } from "../../core/workRunner.ts";
import { AddRunnerLink } from "../workRunner.tsx";

export function RepositoryNextStep(props: {
  readonly partition: PartitionIdentity;
  readonly ticketOffered: boolean;
  readonly runner: WorkRunner;
}): ReactNode {
  const step = repositoryNextStep(props.ticketOffered, props.runner);
  if (step === undefined) return null;
  return (
    <>
      {" · "}
      {step === "AddRunner" ? (
        <AddRunnerLink partition={props.partition} />
      ) : (
        <Link to="/$tenant/$project/tickets/new" params={props.partition}>
          New ticket
        </Link>
      )}
    </>
  );
}
