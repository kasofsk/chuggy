/**
 * One Filter control in a list's bar, and the marks under the bar naming what
 * narrows the list. The control shows how many filters are set, and opens a
 * panel holding every filter the caller hands it, with a clear-all: a popover
 * where the page that draws the bar is wide, and a sheet from the screen's
 * foot where it is narrow. Each mark removes its own filter in one press, and
 * with no filter set no mark is drawn.
 *
 * The caller says whether its page is wide, rather than a sheet deciding,
 * because the two are different elements: the popover is Radix's popover,
 * beside its trigger, and the sheet is Radix's modal dialog, which holds the
 * focus as the screen it covers would otherwise not. Neither draws Radix's scroll lock, which appends
 * a `<style>` element the served `style-src 'self'` refuses.
 */

import { Dialog, Popover } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { buttonLookClassName } from "./Button.tsx";
import { CountBadge } from "./CountBadge.tsx";
import { listFilterGlyph } from "./ListControls.tsx";

import "./ListFilter.css";

/** One filter that is set, as its mark names it and takes it away. */
export interface ListFilterMark {
  readonly key: string;
  /** What the filter is about, as its field in the panel is labelled. */
  readonly field: string;
  /** What it is set to. */
  readonly value: string;
  readonly onRemove: () => void;
}

function ListFilterCross(): ReactNode {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="list-filter-cross">
      <path
        d="M3 3 L9 9 M9 3 L3 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The panel's title, its filters and its foot, the same in either frame. */
function ListFilterBody(props: {
  readonly title: ReactNode;
  readonly close: ReactNode;
  readonly setCount: number;
  readonly onClear: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      {props.title}
      <div className="list-filter-fields">{props.children}</div>
      <div className="list-filter-foot">
        <button
          type="button"
          className={buttonLookClassName({ variant: "quiet", size: "sm" })}
          disabled={props.setCount === 0}
          onClick={props.onClear}
        >
          {text({ id: "ui-filter-clear-all" })}
        </button>
        {props.close}
      </div>
    </>
  );
}

/** The trigger's face: the glyph, the label for assistive technology, and how
 * many filters are set where any is. */
function ListFilterFace(props: {
  readonly label: string;
  readonly setCount: number;
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      <span className="visually-hidden">{props.label}</span>
      {listFilterGlyph}
      {props.setCount === 0 ? null : (
        <CountBadge
          count={props.setCount}
          name={text({ id: "ui-filter-set", args: { count: props.setCount } })}
        />
      )}
    </>
  );
}

const listFilterTriggerClassName = `${buttonLookClassName({ size: "sm" })} list-filter-toggle`;

const listFilterCloseClassName = buttonLookClassName({ size: "sm" });

/** What either frame of the panel is drawn from. */
interface ListFilterFrame {
  readonly label: string;
  readonly setCount: number;
  /** The control that opens the panel, which the frame's trigger becomes. */
  readonly trigger: ReactNode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onClear: () => void;
  readonly children: ReactNode;
}

/** The panel as Radix's popover, beside the trigger. */
function ListFilterPopover(props: ListFilterFrame): ReactNode {
  const text = useCopyText();
  return (
    <Popover.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Popover.Trigger asChild>{props.trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="list-filter-panel"
          align="end"
          sideOffset={4}
          aria-label={props.label}
        >
          <ListFilterBody
            title={<h2 className="list-filter-title">{props.label}</h2>}
            close={
              <Popover.Close className={listFilterCloseClassName}>
                {text({ id: "ui-close" })}
              </Popover.Close>
            }
            setCount={props.setCount}
            onClear={props.onClear}
          >
            {props.children}
          </ListFilterBody>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The panel as Radix's modal dialog, a sheet risen from the screen's foot. */
function ListFilterSheet(props: ListFilterFrame): ReactNode {
  const text = useCopyText();
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Trigger asChild>{props.trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <div aria-hidden="true" className="list-filter-scrim" />
        <Dialog.Content
          className="list-filter-panel list-filter-sheet"
          aria-describedby={undefined}
        >
          <ListFilterBody
            title={
              <Dialog.Title className="list-filter-title">
                {props.label}
              </Dialog.Title>
            }
            close={
              <Dialog.Close className={listFilterCloseClassName}>
                {text({ id: "ui-close" })}
              </Dialog.Close>
            }
            setCount={props.setCount}
            onClear={props.onClear}
          >
            {props.children}
          </ListFilterBody>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ListFilter(props: {
  readonly label: string;
  /** Whether the page the bar is drawn in is wide, which the caller reads. */
  readonly wide: boolean;
  readonly marks: readonly ListFilterMark[];
  readonly onClear: () => void;
  /** Every filter, each a labelled field. */
  readonly children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const Frame = props.wide ? ListFilterPopover : ListFilterSheet;
  const setCount = props.marks.length;
  return (
    <Frame
      label={props.label}
      setCount={setCount}
      trigger={
        <button
          type="button"
          className={listFilterTriggerClassName}
          data-active={setCount === 0 ? undefined : ""}
        >
          <ListFilterFace label={props.label} setCount={setCount} />
        </button>
      }
      open={open}
      onOpenChange={setOpen}
      onClear={props.onClear}
    >
      {props.children}
    </Frame>
  );
}

/** A mark for each filter that is set, each the button that takes it away;
 * nothing where none is. */
export function ListFilterMarks(props: {
  readonly label: string;
  readonly marks: readonly ListFilterMark[];
}): ReactNode {
  const text = useCopyText();
  if (props.marks.length === 0) return null;
  return (
    <ul className="list-filter-marks" aria-label={props.label}>
      {props.marks.map((mark) => {
        const named = text({
          id: "ui-filter-mark",
          args: { field: mark.field, value: mark.value },
        });
        return (
          <li key={mark.key}>
            <button
              type="button"
              className={`${buttonLookClassName({ size: "sm" })} list-filter-mark`}
              aria-label={text({
                id: "ui-filter-remove",
                args: { filter: named },
              })}
              onClick={mark.onRemove}
            >
              <span className="list-filter-mark-text">{named}</span>
              <ListFilterCross />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
