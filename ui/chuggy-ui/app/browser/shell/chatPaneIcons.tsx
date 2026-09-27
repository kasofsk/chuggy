/**
 * The chat pane's controls are drawn as glyphs, each beside its name for a
 * reader who does not see it and, for the icon buttons among them, beside the
 * same name again as hover-and-focus text for a reader who does.
 */

import type { ReactNode } from "react";

import { Button } from "../ui/Button.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";

function ChatPaneGlyph(props: { readonly children: ReactNode }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {props.children}
    </svg>
  );
}

const chatPaneGlyphPaths = {
  chat: <path d="M2.5 4h11v6.5h-6L4.5 13v-2.5h-2z" />,
  new: <path d="M8 3v10M3 8h10" />,
  history: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </>
  ),
  fill: <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />,
  restore: <path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5l4-4M6.5 9.5l-4 4" />,
  rename: <path d="M10.5 2.5l3 3L6 13H3v-3z" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  collapse: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M10 3v10" />
    </>
  ),
  open: <circle cx="8" cy="8" r="3" fill="currentColor" />,
  closed: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.75 8.25 7.25 9.75 10.25 6.5" />
    </>
  ),
  orphaned: <circle cx="8" cy="8" r="5.5" strokeDasharray="2 2" />,
} as const;

export type ChatPaneGlyphName = keyof typeof chatPaneGlyphPaths;

export function ChatPaneIcon(props: {
  readonly glyph: ChatPaneGlyphName;
  readonly label: string;
}): ReactNode {
  return (
    <>
      <ChatPaneGlyph>{chatPaneGlyphPaths[props.glyph]}</ChatPaneGlyph>
      <span className="visually-hidden">{props.label}</span>
    </>
  );
}

/**
 * An icon button of the pane's own quiet, small look, its name spoken once and
 * read twice: as the hidden label that stays its accessible name, and as the
 * tooltip a pointer or a keyboard focus reveals. The tooltip wraps the button
 * rather than sitting on it, so it still opens on focus even where the button
 * itself is disabled and so cannot take focus directly — New, while the
 * reader's own thread is answering.
 */
export function ChatPaneIconButton(props: {
  readonly glyph: ChatPaneGlyphName;
  readonly label: string;
  readonly onClick: () => void;
  readonly pressed?: boolean;
  readonly busy?: boolean;
  readonly disabled?: boolean;
}): ReactNode {
  return (
    <Tooltip text={props.label}>
      <span>
        <Button
          variant="quiet"
          size="sm"
          {...(props.pressed === undefined ? {} : { pressed: props.pressed })}
          {...(props.busy === undefined ? {} : { busy: props.busy })}
          {...(props.disabled === undefined
            ? {}
            : { disabled: props.disabled })}
          onClick={props.onClick}
        >
          <ChatPaneIcon glyph={props.glyph} label={props.label} />
        </Button>
      </span>
    </Tooltip>
  );
}
