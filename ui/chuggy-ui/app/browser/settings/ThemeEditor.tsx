/**
 * A theme of the reader's own made or changed, in a dialog opened from
 * beside the theme picker: a name, the roles a few at a time with the rest
 * under one disclosure, the font and the text size, a preview in the theme
 * being edited, and what fails the contrast rule.
 *
 * A new theme starts as a copy of the one in use; a built-in is only ever
 * copied. Nothing outside the preview changes until a save has landed, and a
 * new theme is worn only once it is chosen. A draft any pairing fails cannot
 * be saved. Deleting asks first; the server takes the choice naming the theme
 * with it, and the reads again say what applies instead.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  themeFonts,
  themeNameCharsMax,
  themeSchemes,
  themeTextSizes,
} from "../../../../../src/contract/appearance.ts";
import type {
  ThemeDocument,
  ThemeRole,
  ThemeScheme,
} from "../../../../../src/contract/appearance.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { OwnedThemeResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  apiCreateOwnTheme,
  apiDeleteOwnTheme,
  apiWriteOwnTheme,
} from "../../core/apiRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { CopyText } from "../../core/copy.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { failureWords } from "../../core/failureWords.ts";
import {
  themeEditingColourTyped,
  themeEditingDirty,
  themeEditingOf,
  themeEditorContrasts,
  themeEditorGroupsOf,
  themeEditorNamed,
  themeEditorSavingOf,
  themeDraftOf,
} from "../../core/themeEditor.ts";
import type {
  ThemeDraft,
  ThemeEditing,
  ThemeEditorSaving,
} from "../../core/themeEditor.ts";
import { themeRefusalOf } from "../../core/themePreferences.ts";
import {
  ownedThemeQuery,
  ownedThemesQuery,
  projectAppearanceQuery,
  themeChoiceQuery,
} from "../../core/themeQueries.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { Button } from "../ui/Button.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { Input } from "../ui/Input.tsx";
import { Select } from "../ui/Select.tsx";
import { ToggleGroup } from "../ui/ToggleGroup.tsx";
import {
  ThemeEditorColours,
  ThemeEditorFaults,
  ThemeEditorUnreadFields,
  themeEditorSchemeWords,
} from "./ThemeEditorFields.tsx";
import { ThemeEditorPreview } from "./ThemeEditorPreview.tsx";

import "./ThemeEditor.css";

/** What the editor opens on: a copy of the theme in use, or one of the
 * reader's own to change. */
export type ThemeEditorOpening =
  | { readonly kind: "Create"; readonly from: ThemeDocument }
  | { readonly kind: "Edit"; readonly theme: OwnedThemeResponse };

/** Every read a theme of the reader's own can change, read again. */
async function themeEditorReread(
  client: QueryClient,
  partition: PartitionIdentity | undefined,
  theme: number | undefined,
): Promise<void> {
  await Promise.all(
    [
      themeChoiceQuery().queryKey,
      ownedThemesQuery().queryKey,
      ...(theme === undefined ? [] : [ownedThemeQuery(theme).queryKey]),
      ...(partition === undefined
        ? []
        : [projectAppearanceQuery(partition).queryKey]),
    ].map((queryKey) => client.invalidateQueries({ queryKey })),
  );
}

interface ThemeEditorSaved {
  readonly theme: number | undefined;
  readonly document: ThemeDocument;
}

function themeEditorSaveWrite(
  partition: PartitionIdentity | undefined,
): ConsoleWrite<ThemeEditorSaved, undefined> {
  return {
    mutationKey: consoleWriteKey("theme-save"),
    write: async (ports, { theme, document }) => {
      if (theme !== undefined) return apiWriteOwnTheme(ports, theme, document);
      const created = await apiCreateOwnTheme(ports, document);
      return created.outcome === "Ok"
        ? { outcome: "Ok", value: undefined }
        : created;
    },
    refusal: themeRefusalOf,
    landed: (client, _value, { theme }) =>
      themeEditorReread(client, partition, theme),
  };
}

function themeEditorDeleteWrite(
  partition: PartitionIdentity | undefined,
): ConsoleWrite<number, undefined> {
  return {
    mutationKey: consoleWriteKey("theme-delete"),
    write: (ports, theme) => apiDeleteOwnTheme(ports, theme),
    refusal: (failure) => failureWords(failure).word,
    landed: (client, _value, theme) =>
      themeEditorReread(client, partition, theme),
  };
}

/** The scheme the page is drawn in now, which the editor opens on. */
function themeEditorSchemeShown(): ThemeScheme {
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen === "dark") return "Dark";
  if (chosen === "light") return "Light";
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "Dark"
    : "Light";
}

function ThemeEditorType(props: {
  readonly draft: ThemeDraft;
  readonly onDrafted: (change: Partial<ThemeDraft>) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="theme-editor-type">
      <Select
        labelShown
        label={text({ id: "settings-theme-editor-font" })}
        value={props.draft.font}
        options={themeFonts.map((font) => ({
          value: font,
          text: text({
            id: "settings-theme-editor-font-choice",
            args: { font },
          }),
        }))}
        onChange={(value) => {
          const font = themeFonts.find((held) => held === value);
          if (font !== undefined) props.onDrafted({ font });
        }}
      />
      <Select
        labelShown
        label={text({ id: "settings-theme-editor-size" })}
        value={props.draft.textSize}
        options={themeTextSizes.map((size) => ({
          value: size,
          text: text({
            id: "settings-theme-editor-size-choice",
            args: { size },
          }),
        }))}
        onChange={(value) => {
          const textSize = themeTextSizes.find((held) => held === value);
          if (textSize !== undefined) props.onDrafted({ textSize });
        }}
      />
    </div>
  );
}

function ThemeEditorName(props: {
  readonly name: string;
  readonly onNamed: (name: string) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <Input
      labelShown
      label={text({ id: "settings-theme-editor-name" })}
      value={props.name}
      {...(themeEditorNamed(props.name)
        ? {}
        : {
            error: text({
              id: "settings-theme-editor-name-refused",
              args: { most: String(themeNameCharsMax) },
            }),
          })}
      onChange={props.onNamed}
    />
  );
}

/** Which scheme's values the fields edit and the preview draws. */
function ThemeEditorScheme(props: {
  readonly scheme: ThemeScheme;
  readonly onScheme: (scheme: ThemeScheme) => void;
}): ReactNode {
  const text = useCopyText();
  const word = (held: ThemeScheme): string =>
    text({ id: themeEditorSchemeWords[held] });
  return (
    <ToggleGroup
      label={text({ id: "settings-theme-editor-scheme" })}
      options={themeSchemes.map(word)}
      value={word(props.scheme)}
      onChange={(chosen) => {
        const scheme = themeSchemes.find((held) => word(held) === chosen);
        if (scheme !== undefined) props.onScheme(scheme);
      }}
    />
  );
}

/** The fields, the preview, the faults and the unread fields, over the
 * editing the dialog holds. */
function ThemeEditorBody(props: {
  readonly editing: ThemeEditing;
  readonly onEditing: (editing: ThemeEditing) => void;
}): ReactNode {
  const text = useCopyText();
  const [scheme, setScheme] = useState<ThemeScheme>(themeEditorSchemeShown);
  const [more, setMore] = useState(false);
  const { editing, onEditing } = props;
  const draft = editing.draft;
  const contrasts = themeEditorContrasts(draft, scheme);
  const typed = (role: ThemeRole, value: string): void => {
    onEditing(themeEditingColourTyped(editing, scheme, role, value));
  };
  const drafted = (change: Partial<ThemeDraft>): void => {
    onEditing({ ...editing, draft: { ...draft, ...change } });
  };
  const colours = { editing, scheme, contrasts, onTyped: typed };
  return (
    <>
      <ThemeEditorName
        name={draft.name}
        onNamed={(name) => {
          drafted({ name });
        }}
      />
      <ThemeEditorScheme scheme={scheme} onScheme={setScheme} />
      <ThemeEditorPreview draft={draft} scheme={scheme} />
      <ThemeEditorColours groups={themeEditorGroupsOf(true)} {...colours} />
      <Disclosure
        open={more}
        onOpenChange={setMore}
        label={text({ id: "settings-theme-editor-more" })}
        look={{ variant: "quiet", size: "sm" }}
        chevron
      >
        <div>
          <ThemeEditorColours
            groups={themeEditorGroupsOf(false)}
            {...colours}
          />
        </div>
      </Disclosure>
      <ThemeEditorType draft={draft} onDrafted={drafted} />
      <ThemeEditorFaults
        draft={draft}
        onTyped={(atScheme, role, value) => {
          onEditing(themeEditingColourTyped(editing, atScheme, role, value));
        }}
      />
      <ThemeEditorUnreadFields unread={editing.unread} />
    </>
  );
}

function ThemeEditorDelete(props: {
  readonly theme: OwnedThemeResponse;
  readonly busy: boolean;
  readonly onDelete: () => void;
}): ReactNode {
  const text = useCopyText();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button
        variant="danger"
        size="sm"
        disabled={props.busy}
        onClick={() => {
          setAsking(true);
        }}
      >
        {text({ id: "settings-theme-editor-delete" })}
      </Button>
      <ConfirmDialog
        title={text({
          id: "settings-theme-editor-delete-title",
          args: { name: props.theme.document.name },
        })}
        confirm={text({ id: "settings-theme-editor-delete" })}
        danger
        open={asking}
        onOpenChange={setAsking}
        onConfirm={props.onDelete}
      >
        {text({ id: "settings-theme-editor-delete-about" })}
      </ConfirmDialog>
    </>
  );
}

/** Delete where the theme is the reader's own, Cancel, and Save, which only
 * a draft that may be saved can press. */
function ThemeEditorFoot(props: {
  readonly owned: OwnedThemeResponse | undefined;
  readonly saved: ThemeEditorSaving;
  readonly busy: boolean;
  readonly saving: boolean;
  readonly onClose: () => void;
  readonly onSave: (document: ThemeDocument) => void;
  readonly onDelete: (theme: number) => void;
}): ReactNode {
  const text = useCopyText();
  const { owned, saved, busy } = props;
  return (
    <>
      {owned === undefined ? null : (
        <ThemeEditorDelete
          theme={owned}
          busy={busy}
          onDelete={() => {
            props.onDelete(owned.theme);
          }}
        />
      )}
      <Button variant="quiet" size="sm" disabled={busy} onClick={props.onClose}>
        {text({ id: "ui-cancel" })}
      </Button>
      <Button
        variant="primary"
        size="sm"
        busy={props.saving}
        disabled={busy || saved.kind !== "Saveable"}
        onClick={() => {
          if (saved.kind === "Saveable") props.onSave(saved.document);
        }}
      >
        {text({ id: "settings-theme-editor-save" })}
      </Button>
    </>
  );
}

/** What the editor opens on: a copy of the theme in use, named as one, or
 * the reader's own theme as it is kept. */
function themeEditorStartOf(
  opening: ThemeEditorOpening,
  text: CopyText,
): ThemeDraft {
  switch (opening.kind) {
    case "Create":
      return themeDraftOf(
        opening.from,
        text({
          id: "settings-theme-editor-copy-name",
          args: { name: opening.from.name },
        }),
      );
    case "Edit":
      return themeDraftOf(opening.theme.document, opening.theme.document.name);
  }
}

function ThemeEditorOpen(props: {
  readonly opening: ThemeEditorOpening;
  readonly partition: PartitionIdentity | undefined;
  readonly onClose: () => void;
}): ReactNode {
  const text = useCopyText();
  const { opening, partition, onClose } = props;
  const [editing, setEditing] = useState(() =>
    themeEditingOf(themeEditorStartOf(opening, text)),
  );
  const saving = useConsoleWrite(themeEditorSaveWrite(partition), {
    drawn: true,
  });
  const deleting = useConsoleWrite(themeEditorDeleteWrite(partition), {
    drawn: true,
  });
  const owned = opening.kind === "Edit" ? opening.theme : undefined;
  const saved = themeEditorSavingOf(editing, owned === undefined);
  const busy = saving.isPending || deleting.isPending;
  const refused = saving.error ?? deleting.error;
  return (
    <Dialog
      title={
        owned === undefined
          ? text({ id: "settings-preferences-theme-new" })
          : text({
              id: "settings-preferences-theme-edit-named",
              args: { name: owned.document.name },
            })
      }
      size="form"
      open
      kept={themeEditingDirty(editing)}
      busy={busy}
      note={refused?.message}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      foot={
        <ThemeEditorFoot
          owned={owned}
          saved={saved}
          busy={busy}
          saving={saving.isPending}
          onClose={onClose}
          onSave={(document) => {
            saving.mutate(
              { theme: owned?.theme, document },
              { onSuccess: onClose },
            );
          }}
          onDelete={(theme) => {
            deleting.mutate(theme, { onSuccess: onClose });
          }}
        />
      }
    >
      <ThemeEditorBody
        editing={editing}
        onEditing={(next) => {
          saving.reset();
          deleting.reset();
          setEditing(next);
        }}
      />
    </Dialog>
  );
}

/** The editor while `opening` is one, fresh each time it opens. */
export function ThemeEditor(props: {
  readonly opening: ThemeEditorOpening | undefined;
  readonly partition: PartitionIdentity | undefined;
  readonly onClose: () => void;
}): ReactNode {
  return props.opening === undefined ? null : (
    <ThemeEditorOpen
      opening={props.opening}
      partition={props.partition}
      onClose={props.onClose}
    />
  );
}
