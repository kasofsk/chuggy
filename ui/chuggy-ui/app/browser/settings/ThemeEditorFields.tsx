/**
 * The theme editor's colour fields and what it says of contrast: each role's
 * light or dark value in the browser's own colour input beside a text field,
 * the pairings that role changes with each one's ratio and verdict under it,
 * and, while any pairing fails, which ones do and the nearest value that
 * passes for each role at fault.
 */

import { useMemo } from "react";
import type { ReactNode } from "react";

import {
  themeSchemes,
  type ThemeRole,
  type ThemeScheme,
} from "../../../../../src/contract/appearance.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";
import {
  themeEditingColourText,
  themeEditorColourRead,
  themeEditorContrasts,
  themeEditorFailingRoles,
  themeEditorNearest,
  themeEditorRatioText,
} from "../../core/themeEditor.ts";
import type {
  ThemeDraft,
  ThemeEditing,
  ThemeEditorContrast,
  ThemeEditorRoleGroup,
} from "../../core/themeEditor.ts";
import { Button } from "../ui/Button.tsx";
import { FormField } from "../ui/FormField.tsx";
import { Notice } from "../ui/Notice.tsx";
import { StatusBadge } from "../ui/StatusBadge.tsx";

/** A colour of the theme, or one a pairing reads, by its name. */
export function themeEditorColourName(text: CopyText, colour: string): string {
  return text({ id: "settings-theme-editor-colour", args: { colour } });
}

function ThemeEditorContrastLines(props: {
  readonly contrasts: readonly ThemeEditorContrast[];
}): ReactNode {
  const text = useCopyText();
  if (props.contrasts.length === 0) return null;
  return (
    <ul className="theme-editor-contrasts">
      {props.contrasts.map(({ pair, ratio, passes }) => (
        <li
          key={`${pair.foreground} ${pair.background}`}
          className="theme-editor-contrast"
        >
          <span className="min-w-0 text-ink-2">
            {text({
              id: "settings-theme-editor-contrast",
              args: {
                foreground: themeEditorColourName(text, pair.foreground),
                background: themeEditorColourName(text, pair.background),
              },
            })}
          </span>
          <span className="text-ink-1">
            {text({
              id: "settings-theme-editor-ratio",
              args: { ratio: themeEditorRatioText(ratio) },
            })}
          </span>
          <StatusBadge tone={passes ? "pass" : "fail"} size="small">
            {passes
              ? text({ id: "settings-theme-editor-passes" })
              : text({
                  id: "settings-theme-editor-fails",
                  args: { least: String(pair.ratioMin) },
                })}
          </StatusBadge>
        </li>
      ))}
    </ul>
  );
}

/** One role's value in the scheme being edited, and the pairings it changes. */
function ThemeEditorColour(props: {
  readonly editing: ThemeEditing;
  readonly scheme: ThemeScheme;
  readonly role: ThemeRole;
  readonly contrasts: readonly ThemeEditorContrast[];
  readonly onTyped: (role: ThemeRole, typed: string) => void;
}): ReactNode {
  const text = useCopyText();
  const { editing, scheme, role } = props;
  const name = themeEditorColourName(text, role);
  const typed = themeEditingColourText(editing, scheme, role);
  const unread = themeEditorColourRead(typed) === undefined;
  return (
    <div className="theme-editor-role">
      <FormField
        label={name}
        {...(unread
          ? { error: text({ id: "settings-theme-editor-colour-unread" }) }
          : {})}
      >
        {(binding) => (
          <span className="theme-editor-colour">
            <input
              type="color"
              className="theme-editor-pick"
              aria-label={text({
                id: "settings-theme-editor-colour-pick",
                args: { name },
              })}
              value={editing.draft.colours[scheme][role]}
              onChange={(event) => {
                props.onTyped(role, event.target.value);
              }}
            />
            <span className="input" data-invalid={unread ? "" : undefined}>
              <input
                className="input-box"
                id={binding.id}
                aria-invalid={binding.invalid}
                aria-describedby={binding.describedBy}
                autoComplete="off"
                spellCheck={false}
                translate="no"
                value={typed}
                onChange={(event) => {
                  props.onTyped(role, event.target.value);
                }}
              />
            </span>
          </span>
        )}
      </FormField>
      <ThemeEditorContrastLines
        contrasts={props.contrasts.filter((contrast) => contrast.role === role)}
      />
    </div>
  );
}

/** The groups' roles, each group a titled set of fields. */
export function ThemeEditorColours(props: {
  readonly groups: readonly ThemeEditorRoleGroup[];
  readonly editing: ThemeEditing;
  readonly scheme: ThemeScheme;
  readonly contrasts: readonly ThemeEditorContrast[];
  readonly onTyped: (role: ThemeRole, typed: string) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="theme-editor-groups">
      {props.groups.map(({ group, roles }) => (
        <fieldset key={group} className="theme-editor-group">
          <legend className="text-sm font-strong text-ink-1">
            {text({ id: "settings-theme-editor-group", args: { group } })}
          </legend>
          {roles.map((role) => (
            <ThemeEditorColour
              key={role}
              editing={props.editing}
              scheme={props.scheme}
              role={role}
              contrasts={props.contrasts}
              onTyped={props.onTyped}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

/** One role failing in one scheme, its failing pairings, and the nearest
 * value that passes where one does. */
interface ThemeEditorFault {
  readonly scheme: ThemeScheme;
  readonly role: ThemeRole;
  readonly failing: readonly ThemeEditorContrast[];
  readonly nearest: string | undefined;
}

function themeEditorFaultsOf(draft: ThemeDraft): readonly ThemeEditorFault[] {
  return themeSchemes.flatMap((scheme) => {
    const contrasts = themeEditorContrasts(draft, scheme);
    return themeEditorFailingRoles(draft, scheme).map((role) => ({
      scheme,
      role,
      failing: contrasts.filter(
        (contrast) => contrast.role === role && !contrast.passes,
      ),
      nearest: themeEditorNearest(draft, scheme, role),
    }));
  });
}

export const themeEditorSchemeWords = {
  Light: "settings-preferences-scheme-light",
  Dark: "settings-preferences-scheme-dark",
} as const satisfies Record<ThemeScheme, string>;

/** Which pairings keep the draft from being saved, in either scheme, and
 * the value offered for each role at fault. */
export function ThemeEditorFaults(props: {
  readonly draft: ThemeDraft;
  readonly onTyped: (
    scheme: ThemeScheme,
    role: ThemeRole,
    typed: string,
  ) => void;
}): ReactNode {
  const text = useCopyText();
  const faults = useMemo(() => themeEditorFaultsOf(props.draft), [props.draft]);
  if (faults.length === 0) return null;
  return (
    <Notice tone="danger" inline>
      <div className="theme-editor-faults">
        <p>{text({ id: "settings-theme-editor-failing" })}</p>
        {faults.map(({ scheme, role, failing, nearest }) => (
          <div key={`${scheme} ${role}`} className="theme-editor-fault">
            <p className="font-strong">
              {text({
                id: "settings-theme-editor-failing-role",
                args: {
                  name: themeEditorColourName(text, role),
                  scheme: text({ id: themeEditorSchemeWords[scheme] }),
                },
              })}
            </p>
            <ThemeEditorContrastLines contrasts={failing} />
            {nearest === undefined ? (
              <p>{text({ id: "settings-theme-editor-nearest-none" })}</p>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  props.onTyped(scheme, role, nearest);
                }}
              >
                {text({
                  id: "settings-theme-editor-nearest",
                  args: { colour: nearest },
                })}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Notice>
  );
}
