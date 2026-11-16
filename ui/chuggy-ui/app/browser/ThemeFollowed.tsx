/**
 * The theme the console wears, following the route: the project's resolved
 * theme inside a project, and the reader's global choice outside every one.
 * It draws nothing. A read that has not answered, or failed, wears what was
 * kept for the scope; each answer, a write's included, is worn as it lands.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect } from "react";

import type {
  ThemeChoice,
  ThemeDocument,
} from "../../../../src/contract/appearance.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  ownedThemeQuery,
  projectAppearanceQuery,
  themeChoiceQuery,
} from "../core/themeQueries.ts";
import { themeGlobalOf, themeScopeOf } from "../core/themeTokens.ts";
import type { ThemeScope } from "../core/themeTokens.ts";
import { usePanelState } from "./api.ts";
import { persistentStore } from "./ports.ts";
import { themeWear } from "./themeWorn.ts";

function ThemeWorn(props: {
  readonly scope: ThemeScope;
  readonly theme: ThemeDocument | undefined;
}): ReactNode {
  const { scope, theme } = props;
  const tenant = scope?.tenant;
  const project = scope?.project;
  useEffect(() => {
    themeWear(
      document.documentElement,
      persistentStore,
      themeScopeOf({ tenant, project }),
      theme,
    );
  }, [tenant, project, theme]);
  return null;
}

function ThemeOfProject(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const state = usePanelState(projectAppearanceQuery(props.partition));
  return (
    <ThemeWorn
      scope={props.partition}
      theme={state.state === "Ready" ? state.value.theme : undefined}
    />
  );
}

function ThemeOwned(props: {
  readonly choice: ThemeChoice & { readonly kind: "Owned" };
}): ReactNode {
  const state = usePanelState(ownedThemeQuery(props.choice.theme));
  return (
    <ThemeWorn
      scope={undefined}
      theme={themeGlobalOf(
        props.choice,
        state.state === "Ready" ? state.value.document : undefined,
      )}
    />
  );
}

function ThemeOfReader(): ReactNode {
  const state = usePanelState(themeChoiceQuery());
  if (state.state !== "Ready")
    return <ThemeWorn scope={undefined} theme={undefined} />;
  const choice = state.value.choice;
  if (choice?.kind === "Owned") return <ThemeOwned choice={choice} />;
  return (
    <ThemeWorn scope={undefined} theme={themeGlobalOf(choice, undefined)} />
  );
}

export function ThemeFollowed(): ReactNode {
  const scope = themeScopeOf(useParams({ strict: false }));
  return scope === undefined ? (
    <ThemeOfReader />
  ) : (
    <ThemeOfProject partition={scope} />
  );
}
