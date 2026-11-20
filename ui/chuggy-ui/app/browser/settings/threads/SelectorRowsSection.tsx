/**
 * A selector section drawn as rows rather than one text, whose foot counts the
 * rows the open draft moved.
 */

import type { ReactNode } from "react";

import type { Copy } from "../../../core/copy.ts";
import { countFigure } from "../../../core/figures.ts";
import {
  selectorSettingsSection,
  selectorSettingsSectionChangedCount,
  selectorSettingsSectionInherited,
} from "../../../core/selectorSettingsForm.ts";
import type { SelectorSettingsDraft } from "../../../core/selectorSettingsForm.ts";
import { useCopyText } from "../../../copy/CopyProvider.tsx";
import type { SelectorSettingsShown } from "../../selectorSettingsWriting.ts";
import { Figure } from "../../ui/Figure.tsx";
import { StatusBadge } from "../../ui/StatusBadge.tsx";
import { SelectorSection } from "./SelectorSection.tsx";

/** What the page hands a section of rows: the draft, what its write would refuse, and the card's controls. */
export interface SelectorRowsChrome {
  readonly draft: SelectorSettingsDraft;
  readonly faults: Readonly<Record<string, Copy>>;
  readonly editing: boolean;
  readonly editable: boolean;
  /** The draft can be written as it stands. */
  readonly ready: boolean;
  readonly saved: SelectorSettingsShown | undefined;
  readonly onChange: (draft: SelectorSettingsDraft) => void;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
}

/** A row the open draft moved, as its mark with the word for assistive
 * technology: before the key of a closed row, and leading the standing of an
 * open one, whose key is its field's label. */
export function SelectorEditedMark(): ReactNode {
  const text = useCopyText();
  return (
    <StatusBadge tone="live" size="small" compact>
      {text({ id: "settings-threads-edited" })}
    </StatusBadge>
  );
}

export function SelectorRowsSection(
  props: SelectorRowsChrome & {
    readonly name: "models";
    readonly children: ReactNode;
  },
): ReactNode {
  const { name, draft, children, ...card } = props;
  const text = useCopyText();
  const section = selectorSettingsSection(name);
  const changed = selectorSettingsSectionChangedCount(draft, name);
  return (
    <SelectorSection
      {...card}
      title={text(section.title)}
      about={text(section.about)}
      inherited={selectorSettingsSectionInherited(draft, name)}
      changed={changed > 0}
      footLead={
        <Figure
          figure={countFigure(changed, {
            id: "figures-unit-changes",
            args: { count: changed },
          })}
        />
      }
    >
      <div className="selector-limits">{children}</div>
    </SelectorSection>
  );
}
