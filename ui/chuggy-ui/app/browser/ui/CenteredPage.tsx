/**
 * A page that stands alone: one column of a readable measure holding a mark,
 * the title, a body and the actions under it.
 *
 * `landmark` draws the page as the document's `main`, and names the document
 * by its title while it is drawn; a page drawn inside a region that already is
 * one passes `false` and is a plain block, naming nothing. The actions
 * are slots, and `primary` comes first in the document, so where a narrow
 * page stacks them it is the one on top.
 */

import { useEffect } from "react";
import type { ReactNode } from "react";

import "./CenteredPage.css";

function CenteredPageActions(props: {
  readonly primary?: ReactNode;
  readonly secondary?: ReactNode;
}): ReactNode {
  if (props.primary === undefined && props.secondary === undefined) return null;
  return (
    <div className="centered-page-actions">
      {props.primary}
      {props.secondary}
    </div>
  );
}

/** The document named `title` while the page is drawn, and what it was named
 * before once it is not. */
function useCenteredPageDocumentTitle(title: string, named: boolean): void {
  useEffect(() => {
    if (!named) return;
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title, named]);
}

export function CenteredPage(props: {
  readonly landmark: boolean;
  readonly title: string;
  readonly mark?: ReactNode;
  readonly children?: ReactNode;
  readonly primary?: ReactNode;
  readonly secondary?: ReactNode;
}): ReactNode {
  useCenteredPageDocumentTitle(props.title, props.landmark);
  const column = (
    <div className="centered-page-column">
      {props.mark === undefined ? null : (
        <div className="centered-page-mark">{props.mark}</div>
      )}
      <h1 className="centered-page-title">{props.title}</h1>
      {props.children === undefined ? null : (
        <div className="centered-page-body">{props.children}</div>
      )}
      <CenteredPageActions
        primary={props.primary}
        secondary={props.secondary}
      />
    </div>
  );
  if (props.landmark)
    return (
      <main className="centered-page centered-page-landmark">{column}</main>
    );
  return <div className="centered-page">{column}</div>;
}
