/**
 * The reader's theme, chosen in the Appearance section: their global theme,
 * and inside a project the row saying which theme applies there and why, with
 * their own choice for the project.
 *
 * A CHOICE IS WORN AS IT IS PRESSED. The reads the worn theme follows are
 * written with what the choice resolves to before the write is sent, so the
 * page repaints and the picker moves at once; a refused write puts back what
 * they held, which puts the picker and the page back, and its sentence is
 * drawn under the picker. A landed write reads them all again.
 *
 * THE LAST PRESS IS THE ONE KEPT. Theme writes, from either picker, are sent
 * one at a time in the order pressed, so the server keeps the last; only the
 * last press's answer reads again or puts back, and what it puts back is what
 * the server held when it was sent.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useId } from "react";
import type { ReactNode } from "react";

import type { ThemeChoice } from "../../../../../src/contract/appearance.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  OwnedThemeResponse,
  ProjectAppearanceResponse,
  ThemeChoiceResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  apiWriteProjectThemeOverride,
  apiWriteThemeChoice,
} from "../../core/apiRoutes.ts";
import type { ApiResult } from "../../core/apiRequest.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type {
  ConsoleWrite,
  ConsoleWriteRefused,
} from "../../core/consoleWrite.ts";
import type { Copy } from "../../core/copy.ts";
import {
  ownedThemeQuery,
  ownedThemesQuery,
  projectAppearanceQuery,
  themeChoiceQuery,
} from "../../core/themeQueries.ts";
import {
  themeGlobalChosen,
  themeOverrideChosen,
  themePickerOptions,
  themePickerProjectDefault,
  themePreferencesOf,
  themeRefusalOf,
} from "../../core/themePreferences.ts";
import type { ThemePickerOption } from "../../core/themePreferences.ts";
import { themeScopeOf } from "../../core/themeTokens.ts";
import { usePanelState } from "../api.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import { Notice } from "../ui/Notice.tsx";
import { ThemePicker } from "./ThemePicker.tsx";
import type { ThemePickerCard } from "./ThemePicker.tsx";

/** What the worn theme is read from, as it stood before a choice was worn. */
interface ThemeHeld {
  readonly choice: ThemeChoiceResponse | undefined;
  readonly appearance: ProjectAppearanceResponse | undefined;
}

function themeHeldOf(
  client: QueryClient,
  partition: PartitionIdentity | undefined,
): ThemeHeld {
  return {
    choice: client.getQueryData(themeChoiceQuery().queryKey),
    appearance:
      partition === undefined
        ? undefined
        : client.getQueryData(projectAppearanceQuery(partition).queryKey),
  };
}

function themeHeldPut(
  client: QueryClient,
  partition: PartitionIdentity | undefined,
  held: ThemeHeld,
): void {
  if (held.choice !== undefined)
    client.setQueryData(themeChoiceQuery().queryKey, held.choice);
  if (partition !== undefined && held.appearance !== undefined)
    client.setQueryData(
      projectAppearanceQuery(partition).queryKey,
      held.appearance,
    );
}

/** The theme writes of one client: the presses not yet answered, chained in
 * the order pressed, and what the server held as the last answered left it. */
interface ThemeTurn {
  pressed: number;
  unanswered: number;
  worn: Promise<unknown>;
  written: Promise<unknown>;
  kept: ThemeHeld | undefined;
}

const themeTurns = new WeakMap<QueryClient, ThemeTurn>();

function themeTurnOf(client: QueryClient): ThemeTurn {
  const held = themeTurns.get(client);
  if (held !== undefined) return held;
  const turn: ThemeTurn = {
    pressed: 0,
    unanswered: 0,
    worn: Promise.resolve(),
    written: Promise.resolve(),
    kept: undefined,
  };
  themeTurns.set(client, turn);
  return turn;
}

function themeReadKeys(
  partition: PartitionIdentity | undefined,
): readonly (readonly unknown[])[] {
  return [
    themeChoiceQuery().queryKey,
    ...(partition === undefined
      ? []
      : [projectAppearanceQuery(partition).queryKey]),
  ];
}

/** The write sent with `worn` put on the reads first, after every earlier
 * press's write has answered; where it is refused and no press followed it,
 * the reads are put back to what the server held. */
async function themeHeldWhile(
  client: QueryClient,
  partition: PartitionIdentity | undefined,
  worn: (held: ThemeHeld) => void,
  write: () => Promise<ApiResult<undefined>>,
): Promise<ApiResult<undefined>> {
  const turn = themeTurnOf(client);
  const press = (turn.pressed += 1);
  const first = turn.unanswered === 0;
  turn.unanswered += 1;
  const wearing = turn.worn.then(async () => {
    await Promise.all(
      themeReadKeys(partition).map((queryKey) =>
        client.cancelQueries({ queryKey }),
      ),
    );
    const held = themeHeldOf(client, partition);
    if (first) turn.kept = held;
    worn(held);
    return themeHeldOf(client, partition);
  });
  turn.worn = wearing.catch(() => undefined);
  const writing = Promise.all([wearing, turn.written]).then(async () =>
    write(),
  );
  turn.written = writing.catch(() => undefined);
  let written: ApiResult<undefined> | undefined;
  try {
    written = await writing;
    return written;
  } finally {
    turn.unanswered -= 1;
    if (written?.outcome === "Ok") turn.kept = await wearing;
    else if (press === turn.pressed && turn.kept !== undefined)
      themeHeldPut(client, partition, turn.kept);
  }
}

/** The reads again, once no later press is still unanswered: that press's
 * answer reads them again, and a read of this one would undo its wearing. */
async function themeReread(
  client: QueryClient,
  partition: PartitionIdentity | undefined,
): Promise<void> {
  if (themeTurnOf(client).unanswered > 0) return;
  await Promise.all(
    themeReadKeys(partition).map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );
}

function themeGlobalWrite(
  partition: PartitionIdentity | undefined,
  owned: readonly OwnedThemeResponse[],
): ConsoleWrite<ThemeChoice, undefined> {
  return {
    mutationKey: consoleWriteKey("theme-choice"),
    write: (ports, choice, client) =>
      themeHeldWhile(
        client,
        partition,
        (held) => {
          client.setQueryData(themeChoiceQuery().queryKey, { choice });
          const document =
            choice.kind === "Owned"
              ? owned.find((theme) => theme.theme === choice.theme)
              : undefined;
          if (document !== undefined)
            client.setQueryData(
              ownedThemeQuery(document.theme).queryKey,
              document,
            );
          if (partition !== undefined && held.appearance !== undefined)
            client.setQueryData(
              projectAppearanceQuery(partition).queryKey,
              themeGlobalChosen(held.appearance, choice, owned),
            );
        },
        () => apiWriteThemeChoice(ports, choice),
      ),
    refusal: themeRefusalOf,
    landed: (client) => themeReread(client, partition),
  };
}

function themeOverrideWrite(
  partition: PartitionIdentity,
  owned: readonly OwnedThemeResponse[],
): ConsoleWrite<ThemeChoice | undefined, undefined> {
  return {
    mutationKey: consoleWriteKey(
      "theme-override",
      partition.tenant,
      partition.project,
    ),
    write: (ports, choice, client) =>
      themeHeldWhile(
        client,
        partition,
        (held) => {
          if (held.appearance !== undefined)
            client.setQueryData(
              projectAppearanceQuery(partition).queryKey,
              themeOverrideChosen(held.appearance, choice, owned),
            );
        },
        () => apiWriteProjectThemeOverride(ports, partition, choice),
      ),
    refusal: themeRefusalOf,
    landed: (client) => themeReread(client, partition),
  };
}

function themeCards(
  options: readonly ThemePickerOption[],
): readonly ThemePickerCard[] {
  return options.map((option) => ({
    key: option.key,
    name: option.theme.name,
    data: true,
    theme: option.theme,
  }));
}

function ThemeRefused(props: {
  readonly refused: ConsoleWriteRefused | null;
}): ReactNode {
  return props.refused === null ? null : (
    <Notice tone="danger" inline>
      <ConsoleWriteRefusedWords refused={props.refused} />
    </Notice>
  );
}

/** The row for the project the reader is in: which theme applies and why,
 * and their own choice for it, or the project's default. */
function PreferencesThemeHere(props: {
  readonly partition: PartitionIdentity;
  readonly chosen: string;
  readonly applies: string;
  readonly because: Copy;
  readonly options: readonly ThemePickerOption[];
  readonly owned: readonly OwnedThemeResponse[];
}): ReactNode {
  const text = useCopyText();
  const said = useId();
  const writing = useConsoleWrite(
    themeOverrideWrite(props.partition, props.owned),
    { drawn: true },
  );
  const label = text({ id: "settings-preferences-theme-here" });
  return (
    <div className="preferences-theme">
      <p className="font-strong text-ink-1">{label}</p>
      <p id={said} className="preferences-theme-applies text-sm">
        <span className="font-strong text-ink-1" translate="no">
          {props.applies}
        </span>
        <span className="text-ink-3">{text(props.because)}</span>
      </p>
      <ThemePicker
        label={label}
        value={props.chosen}
        describedBy={said}
        cards={[
          {
            key: themePickerProjectDefault,
            name: text({
              id: "settings-preferences-theme-here-project-default",
            }),
            data: false,
            theme: undefined,
          },
          ...themeCards(props.options),
        ]}
        onChoose={(key) => {
          if (key === themePickerProjectDefault) {
            writing.mutate(undefined);
            return;
          }
          const option = props.options.find((held) => held.key === key);
          if (option !== undefined) writing.mutate(option.choice);
        }}
      />
      <ThemeRefused refused={writing.error} />
    </div>
  );
}

function PreferencesThemeGlobal(props: {
  readonly partition: PartitionIdentity | undefined;
  readonly chosen: string;
  readonly covered: Copy | undefined;
  readonly options: readonly ThemePickerOption[];
  readonly owned: readonly OwnedThemeResponse[];
}): ReactNode {
  const text = useCopyText();
  const covered = useId();
  const writing = useConsoleWrite(
    themeGlobalWrite(props.partition, props.owned),
    { drawn: true },
  );
  const label = text({ id: "settings-preferences-theme" });
  return (
    <div className="preferences-theme">
      <p className="font-strong text-ink-1">{label}</p>
      {props.covered === undefined ? null : (
        <p id={covered} className="text-sm text-ink-3">
          {text(props.covered)}
        </p>
      )}
      <ThemePicker
        label={label}
        value={props.chosen}
        describedBy={props.covered === undefined ? undefined : covered}
        cards={themeCards(props.options)}
        onChoose={(key) => {
          const option = props.options.find((held) => held.key === key);
          if (option !== undefined) writing.mutate(option.choice);
        }}
      />
      <ThemeRefused refused={writing.error} />
    </div>
  );
}

function PreferencesThemeRead(props: {
  readonly partition: PartitionIdentity | undefined;
  readonly appearance: ProjectAppearanceResponse | undefined;
}): ReactNode {
  const choice = usePanelState(themeChoiceQuery());
  const ownedState = usePanelState(ownedThemesQuery());
  if (choice.state !== "Ready") return null;
  const owned = ownedState.state === "Ready" ? ownedState.value.themes : [];
  const options = themePickerOptions(owned);
  const said = themePreferencesOf(choice.value.choice, props.appearance);
  return (
    <>
      <PreferencesThemeGlobal
        partition={props.partition}
        chosen={said.global.chosen}
        covered={said.global.covered}
        options={options}
        owned={owned}
      />
      {props.partition === undefined || said.project === undefined ? null : (
        <PreferencesThemeHere
          partition={props.partition}
          chosen={said.project.chosen}
          applies={said.project.applies}
          because={said.project.because}
          options={options}
          owned={owned}
        />
      )}
    </>
  );
}

function PreferencesThemeOfProject(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const appearance = usePanelState(projectAppearanceQuery(props.partition));
  return (
    <PreferencesThemeRead
      partition={props.partition}
      appearance={appearance.state === "Ready" ? appearance.value : undefined}
    />
  );
}

/** The global picker everywhere, and the project's row while one is open. */
export function PreferencesTheme(): ReactNode {
  const partition = themeScopeOf(useParams({ strict: false }));
  return partition === undefined ? (
    <PreferencesThemeRead partition={undefined} appearance={undefined} />
  ) : (
    <PreferencesThemeOfProject partition={partition} />
  );
}
