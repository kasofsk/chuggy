/**
 * What a repository's head says of one configuration the Catalog page draws,
 * against the newest version an import made of it.
 *
 * THE HEAD IS COMPARED BY DIGEST, the address an import would store it under,
 * so a head that declares the same configuration in other bytes of the same
 * canonical form matches, and one that declares anything else differs.
 */

import type {
  RepositoryConfigurationHeadDeclaration,
  RepositoryConfigurationHeadResponse,
} from "../../../../src/contract/responses.ts";
import type { Copy } from "./copy.ts";
import { commitLabel } from "./labels.ts";

type CatalogHeadRead = RepositoryConfigurationHeadResponse["head"];

type CatalogHeadFault = Extract<
  CatalogHeadRead,
  { readonly state: "ConfigurationsRefused" }
>["faults"][number];

/** Where the head was read, for the line that names it. */
export interface CatalogHeadAt {
  readonly branch: string;
  readonly commit: string;
}

export type CatalogHeadStanding =
  | { readonly standing: "Matches"; readonly at: CatalogHeadAt }
  | {
      readonly standing: "Differs";
      readonly at: CatalogHeadAt;
      readonly declaration: RepositoryConfigurationHeadDeclaration;
    }
  | { readonly standing: "Undeclared"; readonly at: CatalogHeadAt }
  | {
      readonly standing: "Refused";
      readonly at: CatalogHeadAt;
      readonly faults: readonly CatalogHeadFault[];
    }
  | {
      readonly standing: "Unread";
      readonly why: "BranchAbsent" | "CommitAbsent" | "SnapshotRefused";
    };

/** The configuration the head declares under a name, none where it declares none. */
export function catalogHeadDeclaration(
  head: CatalogHeadRead,
  name: string,
): RepositoryConfigurationHeadDeclaration | undefined {
  return head.state === "Ready"
    ? head.configurations.find((declared) => declared.name === name)
    : undefined;
}

export function catalogHeadStandingOf(
  head: CatalogHeadRead,
  name: string,
  digest: string,
): CatalogHeadStanding {
  switch (head.state) {
    case "BranchAbsent":
    case "CommitAbsent":
    case "SnapshotRefused":
      return { standing: "Unread", why: head.state };
    case "ConfigurationsAbsent":
      return { standing: "Undeclared", at: head };
    case "ConfigurationsRefused":
      return { standing: "Refused", at: head, faults: head.faults };
    case "Ready": {
      const declaration = catalogHeadDeclaration(head, name);
      if (declaration === undefined)
        return { standing: "Undeclared", at: head };
      return declaration.digest === digest
        ? { standing: "Matches", at: head }
        : { standing: "Differs", at: head, declaration };
    }
  }
}

/** Where the head was read, as the variables a line names it by. */
function catalogHeadAtArgs(at: CatalogHeadAt): {
  readonly branch: string;
  readonly commit: string;
} {
  return { branch: at.branch, commit: commitLabel(at.commit).text };
}

const catalogHeadUnreadTexts: Readonly<
  Record<
    Extract<CatalogHeadStanding, { readonly standing: "Unread" }>["why"],
    Copy
  >
> = {
  BranchAbsent: { id: "configuration-catalog-head-branch-absent" },
  CommitAbsent: { id: "configuration-catalog-head-commit-absent" },
  SnapshotRefused: { id: "configuration-catalog-head-snapshot-refused" },
};

/** What the head says of the configuration, in the one line the page draws it as. */
export function catalogHeadText(
  standing: CatalogHeadStanding,
  name: string,
): Copy {
  switch (standing.standing) {
    case "Matches":
      return {
        id: "configuration-catalog-head-matches",
        args: { ...catalogHeadAtArgs(standing.at), name },
      };
    case "Differs":
      return {
        id: "configuration-catalog-head-differs",
        args: { ...catalogHeadAtArgs(standing.at), name },
      };
    case "Undeclared":
      return {
        id: "configuration-catalog-head-undeclared",
        args: { ...catalogHeadAtArgs(standing.at), name },
      };
    case "Refused":
      return {
        id: "configuration-catalog-head-refused",
        args: catalogHeadAtArgs(standing.at),
      };
    case "Unread":
      return catalogHeadUnreadTexts[standing.why];
  }
}

/** What the page says while it draws the head's version in the import's place. */
export function catalogHeadShowingText(at: CatalogHeadAt, name: string): Copy {
  return {
    id: "configuration-catalog-head-showing",
    args: { ...catalogHeadAtArgs(at), name },
  };
}

/** One fault an import of the head would be refused with, as the page lists it. */
export function catalogHeadFaultText(fault: CatalogHeadFault): string {
  return [fault.path, fault.fault, fault.configurationFault, fault.reference]
    .filter((part) => part !== undefined)
    .join(" · ");
}
