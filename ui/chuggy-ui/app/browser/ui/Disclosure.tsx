/**
 * A trigger and the body it shows, wired to each other and drawing no box of
 * their own, so the layout that held them as siblings still does.
 */

import { Collapsible } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

import "./Disclosure.css";

export function Disclosure(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly label: ReactNode;
  readonly children: ReactElement;
}): ReactNode {
  return (
    <Collapsible.Root
      className="disclosure"
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <Collapsible.Trigger>{props.label}</Collapsible.Trigger>
      <Collapsible.Content asChild>{props.children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
