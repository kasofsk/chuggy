/**
 * The chat pane's controls are drawn as glyphs, each beside its name for a
 * reader who does not see it and, for the icon buttons among them, beside the
 * same name again as hover-and-focus text for a reader who does.
 *
 * THE HEADER IS ONE ROW of them beside the thread's title, and anything it has
 * to say in words goes on a row of its own under that one.
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

/** A glyph drawn on lucide's 24-unit grid, as chuggernaut draws its pane's
 * controls, scaled to this one at the same stroke as the rest. */
function ChatPaneLucide(props: { readonly children: ReactNode }): ReactNode {
  return (
    <g transform="scale(0.6667)" strokeWidth="2.25">
      {props.children}
    </g>
  );
}

const chatPanePanel = <rect width="18" height="18" x="3" y="3" rx="2" />;

const chatPaneGlyphPaths = {
  new: <path d="M8 3v10M3 8h10" />,
  history: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </>
  ),
  fill: (
    <ChatPaneLucide>
      <path d="M15 3h6v6M21 3l-7 7M3 21l7-7M9 21H3v-6" />
    </ChatPaneLucide>
  ),
  restore: (
    <ChatPaneLucide>
      <path d="m14 10 7-7M20 10h-6V4M3 21l7-7M4 14h6v6" />
    </ChatPaneLucide>
  ),
  rename: <path d="M10.5 2.5l3 3L6 13H3v-3z" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  collapseRight: (
    <ChatPaneLucide>
      {chatPanePanel}
      <path d="M15 3v18m-7-12 3 3-3 3" />
    </ChatPaneLucide>
  ),
  expandRight: (
    <ChatPaneLucide>
      {chatPanePanel}
      <path d="M15 3v18m-5-6-3-3 3-3" />
    </ChatPaneLucide>
  ),
  collapseLeft: (
    <ChatPaneLucide>
      {chatPanePanel}
      <path d="M9 3v18m7-6-3-3 3-3" />
    </ChatPaneLucide>
  ),
  expandLeft: (
    <ChatPaneLucide>
      {chatPanePanel}
      <path d="M9 3v18m5-12 3 3-3 3" />
    </ChatPaneLucide>
  ),
  collapseBottom: (
    <ChatPaneLucide>
      {chatPanePanel}
      <path d="M3 15h18M15 8l-3 3-3-3" />
    </ChatPaneLucide>
  ),
  expandBottom: (
    <ChatPaneLucide>
      {chatPanePanel}
      <path d="M3 15h18M9 10l3-3 3 3" />
    </ChatPaneLucide>
  ),
  open: <circle cx="8" cy="8" r="3" fill="currentColor" />,
  closed: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.75 8.25 7.25 9.75 10.25 6.5" />
    </>
  ),
  orphaned: <circle cx="8" cy="8" r="5.5" strokeDasharray="2 2" />,
  more: (
    <ChatPaneLucide>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </ChatPaneLucide>
  ),
  page: (
    <ChatPaneLucide>
      <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6M21 3l-9 9M15 3h6v6" />
    </ChatPaneLucide>
  ),
  link: (
    <ChatPaneLucide>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </ChatPaneLucide>
  ),
  copied: (
    <ChatPaneLucide>
      <path d="M20 6 9 17l-5-5" />
    </ChatPaneLucide>
  ),
} as const;

export type ChatPaneGlyphName = keyof typeof chatPaneGlyphPaths;

/** A glyph alone, beside a name that is already its words. */
export function ChatPaneMark(props: {
  readonly glyph: ChatPaneGlyphName;
}): ReactNode {
  return <ChatPaneGlyph>{chatPaneGlyphPaths[props.glyph]}</ChatPaneGlyph>;
}

export function ChatPaneIcon(props: {
  readonly glyph: ChatPaneGlyphName;
  readonly label: string;
}): ReactNode {
  return (
    <>
      <ChatPaneMark glyph={props.glyph} />
      <span className="visually-hidden">{props.label}</span>
    </>
  );
}

/**
 * An icon button of the pane's own quiet look, its name spoken once and
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
  readonly busy?: boolean;
  readonly disabled?: boolean;
}): ReactNode {
  return (
    <Tooltip text={props.label}>
      <span className="flex">
        <Button
          variant="quiet"
          size="icon"
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

/** What the pane's header says under its one row, on a row of its own: a
 * refusal, what a door asks, a question asked before closing. */
export function ChatPaneHeaderRow(props: {
  readonly children: ReactNode;
}): ReactNode {
  return <div className="order-last w-full min-w-0">{props.children}</div>;
}
