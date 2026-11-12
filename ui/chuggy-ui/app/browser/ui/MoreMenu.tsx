/**
 * The ⋯ menu a header keeps its lesser actions in: one trigger that is only
 * the glyph, named by the caller, over a menu of the items it is handed. An
 * item is a link, an action, or a destructive action, which is drawn in the
 * danger tone and whose label is the word that says what it ends.
 */

import { DropdownMenu } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

import { buttonLookClassName } from "./Button.tsx";
import { MenuContent, menuItemClassName } from "./Menu.tsx";

import "./MoreMenu.css";

/** What a link item's anchor is given, so the caller's router link carries
 * the label and the item's look while keeping the routes it checks. */
export interface MoreMenuAnchor {
  readonly className: string;
  readonly children: string;
}

export type MoreMenuItem =
  | {
      readonly kind: "link";
      readonly label: string;
      readonly link: (anchor: MoreMenuAnchor) => ReactElement;
    }
  | {
      readonly kind: "action" | "destructive";
      readonly label: string;
      /** Radix's selection event; preventing it keeps the menu open. */
      readonly onSelect: (event: Event) => void;
      readonly disabled?: boolean;
    };

function MoreMenuMark(): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4"
      fill="currentColor"
    >
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

function MoreMenuEntry(props: { readonly item: MoreMenuItem }): ReactNode {
  const { item } = props;
  if (item.kind === "link")
    return (
      <DropdownMenu.Item asChild className={menuItemClassName}>
        {item.link({
          className: "text-ink-1 no-underline",
          children: item.label,
        })}
      </DropdownMenu.Item>
    );
  return (
    <DropdownMenu.Item
      className={
        item.kind === "destructive"
          ? `${menuItemClassName} more-menu-destructive`
          : menuItemClassName
      }
      disabled={item.disabled ?? false}
      onSelect={item.onSelect}
    >
      {item.label}
    </DropdownMenu.Item>
  );
}

export function MoreMenu(props: {
  /** The trigger's accessible name, since its glyph says nothing. */
  readonly label: string;
  readonly items: readonly MoreMenuItem[];
}): ReactNode {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={`${buttonLookClassName({ size: "icon" })} more-menu-trigger`}
        aria-label={props.label}
      >
        <MoreMenuMark />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent sideOffset={4} align="end">
          {props.items.map((item) => (
            <MoreMenuEntry key={item.label} item={item} />
          ))}
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
