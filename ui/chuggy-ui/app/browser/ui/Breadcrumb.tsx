/**
 * The page a drill-down was reached from, linked before the page's own title.
 */

import { createLink } from "@tanstack/react-router";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import "./Breadcrumb.css";

function BreadcrumbAnchor(props: ComponentPropsWithoutRef<"a">): ReactNode {
  return <a {...props} className="breadcrumb-link" />;
}

/** The router's own link, styled to read as a crumb rather than as a button. */
export const BreadcrumbLink = createLink(BreadcrumbAnchor);

export function Breadcrumb(props: { readonly children: ReactNode }): ReactNode {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-2 text-sm text-ink-3"
    >
      {props.children}
      <span aria-hidden="true">/</span>
    </nav>
  );
}
