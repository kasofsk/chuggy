/**
 * The chat pane's controls are drawn as glyphs, each beside its name for a
 * reader who does not see it.
 */

import type { ReactNode } from "react";

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
