/**
 * The pressable things: an action, a disclosure, a toggle, the button a form
 * is submitted by, and the same look over a route link.
 *
 * Total over `buttonVariants` × `buttonSizes`, and over the states an
 * attribute carries — pressed, busy, disabled. Those are attributes rather
 * than classes because the attribute is what a reader's assistive technology
 * is told, and a class beside it would be a second account of one fact. No
 * form of this takes a `style`: the served policy refuses the attribute in the
 * browser, so a caller who reached for one would get a clean build and a
 * declaration nothing applies.
 */

import { createLink } from "@tanstack/react-router";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import "./Button.css";

export const buttonVariants = [
  "default",
  "primary",
  "danger",
  "quiet",
] as const;

export const buttonSizes = ["md", "sm", "icon"] as const;

export type ButtonVariant = (typeof buttonVariants)[number];
export type ButtonSize = (typeof buttonSizes)[number];

interface ButtonLook {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
}

const buttonPillClassName =
  "btn inline-flex items-center gap-2 rounded-3 font-prose font-medium" +
  " leading-dense whitespace-nowrap no-underline";

const buttonSizeClassNames: Record<ButtonSize, string> = {
  md: "px-4 py-2 text-md",
  sm: "px-3 py-1 text-sm",
  icon: "btn-icon justify-center text-sm",
};

export function buttonLookClassName(look: ButtonLook): string {
  const variant = look.variant ?? "default";
  return `${buttonPillClassName} btn-${variant} ${buttonSizeClassNames[look.size ?? "md"]}`;
}

/** Whose a press is: the caller's, or the form's the button stands in, which
 * hears it as its own submission and so takes no handler here. */
type ButtonPress =
  | { readonly type?: "button"; readonly onClick: () => void }
  | { readonly type: "submit" };

export function Button(
  props: ButtonLook &
    ButtonPress & {
      readonly children: ReactNode;
      readonly pressed?: boolean;
      readonly busy?: boolean;
      readonly disabled?: boolean;
      readonly describedBy?: string;
      readonly expanded?: boolean;
    },
): ReactNode {
  return (
    <button
      type={props.type === "submit" ? "submit" : "button"}
      className={buttonLookClassName(props)}
      onClick={props.type === "submit" ? undefined : props.onClick}
      disabled={props.disabled ?? false}
      aria-pressed={props.pressed}
      aria-busy={props.busy}
      aria-describedby={props.describedBy}
      aria-expanded={props.expanded}
    >
      {props.children}
    </button>
  );
}

function ButtonAnchor(
  props: ButtonLook & Omit<ComponentPropsWithoutRef<"a">, "style">,
): ReactNode {
  const { variant, size, ...anchor } = props;
  return <a {...anchor} className={buttonLookClassName({ variant, size })} />;
}

/** The same look over the router's own link, so a navigation drawn as a button
 * keeps the route types the router checks. */
export const ButtonLink = createLink(ButtonAnchor);
