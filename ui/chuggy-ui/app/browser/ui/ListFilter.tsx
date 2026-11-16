/**
 * A list's filters behind one control in its bar, and what is on drawn under
 * the bar.
 *
 * The control counts the filters on and opens a panel holding each filter
 * once, in labelled groups, with Clear all. Beside a wide list the panel is a
 * popover at the control; on a phone it is a sheet from the screen's foot over
 * a scrim, so a press beside it closes it without reaching the page. Escape,
 * Close and a press outside close it, and focus returns to the control.
 *
 * Each filter on is also a mark under the bar, removed with one press; with
 * none on, nothing is drawn there.
 *
 * Radix's popover is not modal here: its scroll lock appends a `<style>`
 * element the served `style-src 'self'` refuses.
 */

import { Popover } from "radix-ui";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { Button, buttonLookClassName } from "./Button.tsx";
import { Chip } from "./Chip.tsx";
import { CountBadge } from "./CountBadge.tsx";
import { listFilterGlyph } from "./ListControls.tsx";

import "./ListFilter.css";

export function ListFilter(props: {
  /** How many of the panel's filters are on. */
  readonly active: number;
  /** Turns every filter in the panel off. */
  readonly onClear: () => void;
  /** The panel's groups, each a `ListFilterGroup`. */
  readonly children: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const label = text({ id: "ui-list-filter" });
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`${buttonLookClassName({ size: "sm" })} list-filter-toggle`}
        title={label}
        data-active={props.active === 0 ? undefined : ""}
      >
        <span className="visually-hidden">{label}</span>
        {listFilterGlyph}
        {props.active === 0 ? null : (
          <CountBadge
            count={props.active}
            name={text({
              id: "ui-list-filter-on",
              args: { count: props.active },
            })}
          />
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <div className="list-filter-layer">
          <div className="list-filter-scrim" aria-hidden="true" />
          <Popover.Content
            className="list-filter-panel"
            aria-labelledby={titleId}
            align="end"
            sideOffset={4}
          >
            <h2 className="list-filter-title" id={titleId}>
              {label}
            </h2>
            {props.children}
            <div className="list-filter-foot">
              <Button
                variant="quiet"
                size="sm"
                disabled={props.active === 0}
                onClick={() => {
                  props.onClear();
                  setOpen(false);
                }}
              >
                {text({ id: "ui-list-filter-clear" })}
              </Button>
              <Popover.Close className={buttonLookClassName({ size: "sm" })}>
                {text({ id: "ui-close" })}
              </Popover.Close>
            </div>
          </Popover.Content>
        </div>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** One labelled group of the panel's filters. */
export function ListFilterGroup(props: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <fieldset className="list-filter-group">
      <legend className="list-filter-legend">{props.label}</legend>
      {props.children}
    </fieldset>
  );
}

/** A filter that is on, as its mark says it. */
export interface ListFilterMark {
  readonly key: string;
  readonly text: string;
  readonly onRemove: () => void;
}

/** The filters on, one mark each, or nothing where none is. */
export function ListFilterMarks(props: {
  readonly marks: readonly ListFilterMark[];
}): ReactNode {
  const text = useCopyText();
  if (props.marks.length === 0) return null;
  return (
    <ul
      className="list-filter-marks"
      aria-label={text({ id: "ui-list-filter-marks" })}
    >
      {props.marks.map((mark) => (
        <li key={mark.key}>
          <Chip
            removal={{
              name: text({
                id: "ui-list-filter-remove",
                args: { filter: mark.text },
              }),
              onRemove: mark.onRemove,
            }}
          >
            {mark.text}
          </Chip>
        </li>
      ))}
    </ul>
  );
}
