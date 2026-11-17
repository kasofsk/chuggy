/**
 * A settings section's refused write as the section draws a refusal of no one
 * field: the write's own words, in the tone the refusal is.
 */

import type { ReactNode } from "react";

import type { ConsoleWriteRefused } from "../core/consoleWrite.ts";
import { ConsoleWriteRefusedWords } from "./consoleWrite.tsx";
import { Notice } from "./ui/Notice.tsx";
import type { NoticeTone } from "./ui/Notice.tsx";
import type { SettingsSectionRefusal } from "./ui/SettingsSection.tsx";

/** Nothing where the write was not refused. `before` is what the write did
 * stand before it was refused. */
export function settingsSectionRefusalOf(
  refused: ConsoleWriteRefused | null,
  tone: NoticeTone = "danger",
  before: ReactNode = null,
): SettingsSectionRefusal | undefined {
  if (refused === null) return undefined;
  return {
    at: "Section",
    refused,
    line: (
      <>
        {before}
        <Notice tone={tone} inline>
          <ConsoleWriteRefusedWords refused={refused} />
        </Notice>
      </>
    ),
  };
}
