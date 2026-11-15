/**
 * The bar over a list: what the list counts at its start, and at its end its
 * search and its pickers, each drawn as a glyph. It sticks to the top of the
 * page and goes out of the way as `useHeadroom` says, and while it is out of
 * the way nothing in it can be reached; while focus is inside it, it stays.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { buttonLookClassName } from "./Button.tsx";
import { Input } from "./Input.tsx";
import { useHeadroom } from "./useHeadroom.ts";

import "./ListControls.css";

export function ListGlyph(props: { readonly children: ReactNode }): ReactNode {
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

export const listSortGlyph = (
  <ListGlyph>
    <path d="M5 2.5v11M2.5 11 5 13.5 7.5 11M11 13.5v-11M8.5 5 11 2.5 13.5 5" />
  </ListGlyph>
);

export const listFilterGlyph = (
  <ListGlyph>
    <path d="M2.5 3h11L9.5 8v4.5l-3 1.5V8z" />
  </ListGlyph>
);

const listSearchGlyph = (
  <ListGlyph>
    <path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.8 10.8l3 3" />
  </ListGlyph>
);

/** How long the box takes to close, which the room it holds in the row outlasts. */
const listSearchCloseMs = 260;

/** Whether the search is open, and whether its box still holds its room in
 * the row while it closes; opening focuses the box inside `field`. */
function useListSearchOpen(field: RefObject<HTMLSpanElement | null>): {
  readonly open: boolean;
  readonly laidOut: boolean;
  readonly show: () => void;
  readonly close: () => void;
} {
  const [open, setOpen] = useState(false);
  const [laidOut, setLaidOut] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (open) field.current?.querySelector("input")?.focus();
  }, [open, field]);
  useEffect(
    () => () => {
      clearTimeout(closing.current);
    },
    [],
  );
  const show = (): void => {
    clearTimeout(closing.current);
    setOpen(true);
    setLaidOut(true);
  };
  const close = (): void => {
    setOpen(false);
    clearTimeout(closing.current);
    closing.current = setTimeout(() => {
      setLaidOut(false);
    }, listSearchCloseMs);
  };
  return { open, laidOut, show, close };
}

/** The search, which is a button until it is asked for and then the button
 * opened out to the box; closed over a search it holds, the button is marked. */
export function ListSearch(props: {
  readonly label: string;
  readonly placeholder: string;
  readonly search: string;
  readonly onSearch: (search: string) => void;
}): ReactNode {
  const field = useRef<HTMLSpanElement>(null);
  const fieldId = useId();
  const { open, laidOut, show, close } = useListSearchOpen(field);
  return (
    <span
      className="list-search"
      data-open={open || laidOut || undefined}
      data-expanded={open || undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <button
        type="button"
        className={`${buttonLookClassName({ size: "sm" })} list-search-toggle`}
        aria-label={props.label}
        aria-expanded={open}
        aria-controls={fieldId}
        title={props.label}
        data-active={props.search === "" ? undefined : ""}
        onClick={() => {
          if (open) close();
          else show();
        }}
      >
        {listSearchGlyph}
      </button>
      <span
        className="list-search-field"
        id={fieldId}
        ref={field}
        inert={!open}
      >
        <Input
          label={props.label}
          placeholder={props.placeholder}
          value={props.search}
          onChange={props.onSearch}
        />
      </span>
    </span>
  );
}

export function ListControls(props: {
  /** What stands at the bar's start, opposite the search and the pickers. */
  readonly start?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const bar = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const hidden = useHeadroom(bar) && !focused;
  return (
    <div
      className="list-controls"
      ref={bar}
      data-hidden={hidden || undefined}
      inert={hidden}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      {props.start}
      <div className="list-selects">{props.children}</div>
    </div>
  );
}
