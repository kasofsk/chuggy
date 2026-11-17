/**
 * A small sample of the console drawn in the theme being edited, in the
 * scheme being edited: a row of the tickets list, a button of each kind, a
 * badge of each state, and a line on each surface.
 *
 * The theme is set on the sample alone, through the object model as the
 * picker's swatches are, so nothing outside it changes. The washes and fills
 * the sheet mixes from the page's own surfaces are set beside the roles, from
 * the contract's own mixes, and so is the retired tone the sheet takes from
 * the quiet text, since a token the root resolved would follow the root's
 * theme; the text size, which the root sets, is the sample's zoom. The
 * sample takes no press and no focus.
 */

import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

import {
  themeFillColour,
  themeFills,
  themeTextSizeRootPercents,
  themeWashColour,
  themeWashes,
} from "../../../../../src/contract/appearance.ts";
import type {
  ThemeRole,
  ThemeScheme,
} from "../../../../../src/contract/appearance.ts";
import { phaseRoster } from "../../../../../src/contract/rosters.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { phaseLabel } from "../../core/codeLabels.ts";
import type { ThemeDraft } from "../../core/themeEditor.ts";
import {
  themeFontStacks,
  themeFontToken,
  themeRoleTokens,
} from "../../core/themeTokens.ts";
import type { ThemeAssignment } from "../../core/themeTokens.ts";
import { phaseTone } from "../../core/tones.ts";
import { Button, buttonVariants } from "../ui/Button.tsx";
import { StatusBadge } from "../ui/StatusBadge.tsx";

/** What the sample sets on itself to be drawn in `scheme` of `draft`. */
export function themeEditorPreviewAssignments(
  draft: ThemeDraft,
  scheme: ThemeScheme,
): readonly ThemeAssignment[] {
  const colours = draft.colours[scheme];
  return [
    ...Object.entries(themeRoleTokens).flatMap(([role, properties]) =>
      properties.map((property) => ({
        property,
        value: colours[role as ThemeRole],
      })),
    ),
    ...themeWashes.map((wash) => ({
      property: `--${wash}`,
      value: themeWashColour(scheme, colours, wash),
    })),
    { property: "--tone-retired", value: colours["ink-3"] },
    ...themeFills.map((fill) => ({
      property: `--${fill}`,
      value: themeFillColour(scheme, colours, fill),
    })),
    { property: themeFontToken, value: themeFontStacks[draft.font] },
    {
      property: "zoom",
      value: String(themeTextSizeRootPercents[draft.textSize] / 100),
    },
  ];
}

/** The number the sample row's ticket is drawn with. */
const themeEditorPreviewTicket = 12;

const themeEditorPreviewSurfaces = [
  ["surface-0", "bg-surface-0 text-ink-1"],
  ["surface-1", "bg-surface-1 text-ink-1"],
  ["surface-2", "bg-surface-2 text-ink-1"],
  ["bubble", "bg-bubble text-ink-1"],
  ["surface-inverse", "bg-surface-inverse text-ink-inverse"],
] as const satisfies readonly (readonly [ThemeRole, string])[];

function ThemeEditorPreviewSample(): ReactNode {
  const text = useCopyText();
  return (
    <>
      <p className="theme-preview-row">
        <span className="text-ink-3" translate="no">
          {`#${String(themeEditorPreviewTicket)}`}
        </span>
        <span className="min-w-0 text-ink-1">
          {text({ id: "settings-theme-editor-preview-title" })}
        </span>
        <StatusBadge tone={phaseTone("Work")} size="small">
          {text(phaseLabel("Work"))}
        </StatusBadge>
      </p>
      <div className="flex flex-wrap gap-2">
        {buttonVariants.map((variant) => (
          <Button key={variant} variant={variant} size="sm" onClick={() => {}}>
            {text({
              id: "settings-theme-editor-preview-button",
              args: { variant },
            })}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {phaseRoster.map((phase) => (
          <StatusBadge key={phase} tone={phaseTone(phase)} size="small">
            {text(phaseLabel(phase))}
          </StatusBadge>
        ))}
      </div>
      {themeEditorPreviewSurfaces.map(([surface, look]) => (
        <p key={surface} className={`theme-preview-surface ${look}`}>
          {text({
            id: "settings-theme-editor-preview-surface",
            args: {
              surface: text({
                id: "settings-theme-editor-colour",
                args: { colour: surface },
              }),
            },
          })}
        </p>
      ))}
    </>
  );
}

export function ThemeEditorPreview(props: {
  readonly draft: ThemeDraft;
  readonly scheme: ThemeScheme;
}): ReactNode {
  const text = useCopyText();
  const sample = useRef<HTMLDivElement>(null);
  const { draft, scheme } = props;
  useLayoutEffect(() => {
    const element = sample.current;
    if (element === null) return;
    for (const { property, value } of themeEditorPreviewAssignments(
      draft,
      scheme,
    ))
      element.style.setProperty(property, value);
  }, [draft, scheme]);
  const label = text({ id: "settings-theme-editor-preview" });
  return (
    <section aria-label={label} className="theme-preview-frame">
      <p className="text-sm font-strong text-ink-1">{label}</p>
      <div
        ref={sample}
        className="theme-preview"
        data-scheme={scheme === "Dark" ? "dark" : "light"}
        inert
      >
        <ThemeEditorPreviewSample />
      </div>
    </section>
  );
}
