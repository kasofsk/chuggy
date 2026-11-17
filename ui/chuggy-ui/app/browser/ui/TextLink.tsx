/**
 * A route link drawn as the words of the line it sits in, which on a narrow
 * screen is a finger's height and width without changing what it says.
 *
 * It takes no `style` and no class of its caller's: the look is this sheet's,
 * so a page that draws a link in its prose holds no control style of its own.
 */

import { createLink } from "@tanstack/react-router";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import "./TextLink.css";

function TextAnchor(
  props: Omit<ComponentPropsWithoutRef<"a">, "style" | "className">,
): ReactNode {
  return <a {...props} className="text-link" />;
}

/** The anchor over the router's own link, so the route types stay checked. */
export const TextLink = createLink(TextAnchor);
