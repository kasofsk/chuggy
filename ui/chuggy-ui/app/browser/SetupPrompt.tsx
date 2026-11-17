/**
 * The line a reader pastes into Claude Code to have this site's setup program
 * run in their repository, folded behind the bar that copies it: the one
 * drawing of it, on the welcome page and on the page a project is made at.
 *
 * It is built from the console's own address alone, so it is drawn before any
 * read has answered and does not move when one does.
 */

import type { ReactNode } from "react";

import { useCopyText } from "../copy/CopyProvider.tsx";
import {
  claudeCodeLine,
  claudeCodeLineAbout,
  claudeCodeLineCopy,
} from "../core/claudeCodeLine.ts";
import { currentOrigin } from "./ports.ts";
import { CopyBox } from "./ui/CopyBox.tsx";

export function SetupPrompt(): ReactNode {
  const text = useCopyText();
  return (
    <CopyBox
      about={text(claudeCodeLineAbout)}
      text={claudeCodeLine(currentOrigin())}
      copyLabel={text(claudeCodeLineCopy)}
      breaks="words"
      folded
    />
  );
}
