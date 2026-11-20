/**
 * The theme a project wears for one person: the project's own default, the
 * person's own override for the project, and the one read that resolves them
 * with the person's global choice.
 *
 * THE LAYERS ARE TAKEN HIGHEST FIRST, and the first that names a theme is the
 * one worn: the person's override for the project, the project's default,
 * their global choice, and the built-in default. A layer naming a theme of
 * theirs that no longer exists is resolved as that layer unset.
 *
 * THE PROJECT'S DEFAULT IS READ BY ANYONE WHO MAY READ THE PROJECT AND WRITTEN
 * BY AN ADMINISTRATOR, and held to the contract's contrast rule as a person's
 * own theme is. AN OVERRIDE IS ITS PERSON'S OWN:
 * each call is handed the principal its request authenticated as, and needs
 * only that they may read the project.
 */

import {
  builtInThemeDefault,
  builtInThemes,
  type ThemeChoice,
  type ThemeDocument,
  type ThemeLayer,
} from "../contract/appearance.ts";
import {
  appearanceContrastRefused,
  type AppearanceStore,
  type ThemeContrastRefused,
} from "./appearance.ts";
import type { Authority } from "./operationInbox.ts";
import type { PlacementRead, PlacementWrite } from "./placementRoute.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** An override written or cleared, refused for a theme not the caller's, or for a project that is not there. */
export type ProjectThemeOverrideChosen =
  "Chosen" | "ThemeNotFound" | "NotFound";

/** The project's default and each person's override, and the doors they are written through. */
export interface ProjectThemeStore {
  projectTheme(partition: Partition): Promise<ThemeDocument | undefined>;
  writeProjectTheme(
    partition: Partition,
    document: ThemeDocument | undefined,
    authority: Authority,
  ): Promise<PlacementWrite>;
  override(
    partition: Partition,
    principal: Principal,
  ): Promise<ThemeChoice | undefined>;
  writeOverride(
    partition: Partition,
    principal: Principal,
    choice: ThemeChoice | undefined,
  ): Promise<ProjectThemeOverrideChosen>;
}

/** The project's default, and whether the reader may change it. */
export interface ProjectThemeView {
  readonly document: ThemeDocument | undefined;
  readonly administers: boolean;
}

export type ProjectThemeWritten =
  | { readonly result: "NotFound" }
  | ThemeContrastRefused
  | {
      readonly result: "Written" | "Unchanged";
      readonly view: ProjectThemeView;
    };

/** Each layer's own value, absent where it names none. */
export interface ProjectThemeLayers {
  readonly override: ThemeChoice | undefined;
  readonly projectDefault: ThemeDocument | undefined;
  readonly global: ThemeChoice | undefined;
}

/** The theme worn, the layer it came from, and each layer's own value. */
export interface ProjectAppearanceView {
  readonly theme: ThemeDocument;
  readonly layer: ThemeLayer;
  readonly layers: ProjectThemeLayers;
}

export interface ProjectAppearanceService {
  theme(
    principal: Principal,
    partition: Partition,
  ): Promise<PlacementRead<ProjectThemeView>>;
  writeTheme(
    principal: Principal,
    partition: Partition,
    document: ThemeDocument | undefined,
  ): Promise<ProjectThemeWritten>;
  override(
    principal: Principal,
    partition: Partition,
  ): Promise<PlacementRead<ThemeChoice | undefined>>;
  chooseOverride(
    principal: Principal,
    partition: Partition,
    choice: ThemeChoice | undefined,
  ): Promise<ProjectThemeOverrideChosen>;
  resolved(
    principal: Principal,
    partition: Partition,
  ): Promise<PlacementRead<ProjectAppearanceView>>;
}

/** The document a choice names among `owned`, none where it names a theme no longer there. */
function projectAppearanceChoiceDocument(
  choice: ThemeChoice | undefined,
  owned: ReadonlyMap<number, ThemeDocument>,
): ThemeDocument | undefined {
  if (choice === undefined) return undefined;
  switch (choice.kind) {
    case "BuiltIn":
      return builtInThemes[choice.theme];
    case "Owned":
      return owned.get(choice.theme);
  }
}

/** A choice, or none where it names a theme not among `owned`. */
function projectAppearanceChoiceStanding(
  choice: ThemeChoice | undefined,
  owned: ReadonlyMap<number, ThemeDocument>,
): ThemeChoice | undefined {
  return projectAppearanceChoiceDocument(choice, owned) === undefined
    ? undefined
    : choice;
}

/**
 * The theme `stored` resolves to for a person whose own themes are `owned`,
 * by number: the first layer, highest first, that names a theme still there,
 * and the built-in default where none does. A layer naming one no longer
 * there is answered unset.
 */
export function projectAppearanceResolved(
  stored: ProjectThemeLayers,
  owned: ReadonlyMap<number, ThemeDocument>,
): ProjectAppearanceView {
  const layers: ProjectThemeLayers = {
    override: projectAppearanceChoiceStanding(stored.override, owned),
    projectDefault: stored.projectDefault,
    global: projectAppearanceChoiceStanding(stored.global, owned),
  };
  const candidates: readonly (readonly [
    ThemeLayer,
    ThemeDocument | undefined,
  ])[] = [
    [
      "ProjectOverride",
      projectAppearanceChoiceDocument(layers.override, owned),
    ],
    ["ProjectDefault", layers.projectDefault],
    ["Global", projectAppearanceChoiceDocument(layers.global, owned)],
  ];
  for (const [layer, theme] of candidates)
    if (theme !== undefined) return { theme, layer, layers };
  return {
    theme: builtInThemes[builtInThemeDefault],
    layer: "BuiltInDefault",
    layers,
  };
}

async function projectAppearanceTheme(
  access: ProjectAccess,
  store: ProjectThemeStore,
  principal: Principal,
  partition: Partition,
): Promise<PlacementRead<ProjectThemeView>> {
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return { result: "NotFound" };
  const administers =
    (await access.authorize(principal, partition, "Administer")) !== undefined;
  return {
    result: "Found",
    view: { document: await store.projectTheme(partition), administers },
  };
}

async function projectAppearanceWriteTheme(
  access: ProjectAccess,
  store: ProjectThemeStore,
  principal: Principal,
  partition: Partition,
  document: ThemeDocument | undefined,
): Promise<ProjectThemeWritten> {
  const authority = await access.authorize(principal, partition, "Administer");
  if (authority === undefined) return { result: "NotFound" };
  const refused =
    document === undefined ? undefined : appearanceContrastRefused(document);
  if (refused !== undefined) return refused;
  const written = await store.writeProjectTheme(partition, document, authority);
  if (written === "NotFound") return { result: "NotFound" };
  return {
    result: written,
    view: { document: await store.projectTheme(partition), administers: true },
  };
}

async function projectAppearanceResolvedRead(
  access: ProjectAccess,
  store: ProjectThemeStore,
  appearance: AppearanceStore,
  principal: Principal,
  partition: Partition,
): Promise<PlacementRead<ProjectAppearanceView>> {
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return { result: "NotFound" };
  const [override, projectDefault, global, themes] = await Promise.all([
    store.override(partition, principal),
    store.projectTheme(partition),
    appearance.choice(principal),
    appearance.themes(principal),
  ]);
  const owned = new Map(themes.map((theme) => [theme.theme, theme.document]));
  return {
    result: "Found",
    view: projectAppearanceResolved(
      { override, projectDefault, global },
      owned,
    ),
  };
}

/** One project's appearance over `store`, each person's global layer and own themes read from `appearance`. */
export function projectAppearanceService(
  access: ProjectAccess,
  store: ProjectThemeStore,
  appearance: AppearanceStore,
): ProjectAppearanceService {
  const reads = async (principal: Principal, partition: Partition) =>
    (await access.authorize(principal, partition, "Read")) !== undefined;
  return {
    theme: (principal, partition) =>
      projectAppearanceTheme(access, store, principal, partition),
    writeTheme: (principal, partition, document) =>
      projectAppearanceWriteTheme(
        access,
        store,
        principal,
        partition,
        document,
      ),
    override: async (principal, partition) =>
      (await reads(principal, partition))
        ? { result: "Found", view: await store.override(partition, principal) }
        : { result: "NotFound" },
    chooseOverride: async (principal, partition, choice) =>
      (await reads(principal, partition))
        ? store.writeOverride(partition, principal, choice)
        : "NotFound",
    resolved: (principal, partition) =>
      projectAppearanceResolvedRead(
        access,
        store,
        appearance,
        principal,
        partition,
      ),
  };
}
