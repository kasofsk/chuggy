/**
 * The Radix dropdown-menu panel and item, styled once for every menu the
 * console draws: `Picker` composes it with a radio group, the thread row's
 * menu with plain items.
 */

import { DropdownMenu } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import "./Menu.css";

export const menuItemClassName = "menu-item";

export function MenuContent(
  props: ComponentProps<typeof DropdownMenu.Content>,
): ReactNode {
  const { className, ...rest } = props;
  return (
    <DropdownMenu.Content
      {...rest}
      className={className === undefined ? "menu" : `menu ${className}`}
    />
  );
}
