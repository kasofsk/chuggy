/**
 * One project's appearance held in memory: the project's default, each
 * person's override and global choice, and their own themes, over an access
 * double granting `acme/atlas` alone.
 */

import {
  builtInThemes,
  type ThemeChoice,
  type ThemeDocument,
} from "../../src/contract/appearance.ts";
import type { AppearanceStore } from "../../src/interpreter/appearance.ts";
import {
  projectAppearanceService,
  type ProjectAppearanceService,
  type ProjectThemeStore,
} from "../../src/interpreter/projectAppearance.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";

export const atlas: Partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};

export const reader = asPrincipal("reader");
export const administrator = asPrincipal("administrator");
export const stranger = asPrincipal("stranger");

/** The project's own default in the fixture, the document itself. */
export const projectDocument: ThemeDocument = {
  ...builtInThemes.ember,
  name: "Atlas",
};

/** The kinds each caller holds on `acme/atlas`, and on no other project. */
const held: ReadonlyMap<Principal, readonly ProjectAccessKind[]> = new Map([
  [reader, ["Read"]],
  [administrator, ["Read", "Administer"]],
]);

const access: ProjectAccess = {
  authorize: (principal, partition, kind) =>
    Promise.resolve(
      partition.tenant === atlas.tenant &&
        partition.project === atlas.project &&
        (held.get(principal) ?? []).includes(kind)
        ? memberAuthority(principal)
        : undefined,
    ),
  authorizeTenant: () => Promise.resolve(undefined),
  authorizeSite: projectAccessSiteRefused,
};

/** Every layer of the fixture's one project, and each person's own themes by number. */
export interface ProjectAppearanceHeld {
  projectDefault: ThemeDocument | undefined;
  readonly overrides: Map<Principal, ThemeChoice>;
  readonly globals: Map<Principal, ThemeChoice>;
  readonly owned: Map<Principal, Map<number, ThemeDocument>>;
  readonly writes: string[];
}

function projectAppearanceFixtureThemes(
  held: ProjectAppearanceHeld,
): ProjectThemeStore {
  return {
    projectTheme: () => Promise.resolve(held.projectDefault),
    writeProjectTheme: (_partition, document, authority) => {
      held.writes.push(`project:${authority.subject}:${document?.name ?? ""}`);
      const unchanged = document === held.projectDefault;
      held.projectDefault = document;
      return Promise.resolve(unchanged ? "Unchanged" : "Written");
    },
    override: (_partition, principal) =>
      Promise.resolve(held.overrides.get(principal)),
    writeOverride: (_partition, principal, choice) => {
      held.writes.push(`override:${principal}`);
      if (choice === undefined) {
        held.overrides.delete(principal);
        return Promise.resolve("Chosen");
      }
      if (
        choice.kind === "Owned" &&
        !held.owned.get(principal)?.has(choice.theme)
      )
        return Promise.resolve("ThemeNotFound");
      held.overrides.set(principal, choice);
      return Promise.resolve("Chosen");
    },
  };
}

/** The person's own themes and global choice, as far as the resolved read asks of them. */
function projectAppearanceFixturePersons(
  held: ProjectAppearanceHeld,
): AppearanceStore {
  const refused = () => Promise.reject(new Error("not asked of the fixture"));
  return {
    themes: (principal) =>
      Promise.resolve(
        [
          ...(held.owned.get(principal) ?? new Map<number, ThemeDocument>()),
        ].map(([theme, document]) => ({ theme, document })),
      ),
    theme: refused,
    create: refused,
    write: refused,
    delete: refused,
    choice: (principal) => Promise.resolve(held.globals.get(principal)),
    choose: refused,
  };
}

/** A service over an empty project, and what it holds. */
export function projectAppearanceFixture(): {
  readonly held: ProjectAppearanceHeld;
  readonly service: ProjectAppearanceService;
} {
  const held: ProjectAppearanceHeld = {
    projectDefault: undefined,
    overrides: new Map(),
    globals: new Map(),
    owned: new Map(),
    writes: [],
  };
  return {
    held,
    service: projectAppearanceService(
      access,
      projectAppearanceFixtureThemes(held),
      projectAppearanceFixturePersons(held),
    ),
  };
}
