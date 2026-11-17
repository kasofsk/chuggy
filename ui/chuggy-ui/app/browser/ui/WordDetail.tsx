/**
 * A word and what it carries beyond itself — a failure's code, why a state
 * holds, what a mark means — with the detail drawn after it in the quieter ink
 * rather than in a tooltip, since a touch screen hovers nothing. A detail of
 * more than one line, which a parser's account of what it refused can be, is
 * behind a Details press instead, so it does not crowd the line. Absent
 * detail draws the word alone.
 */

import { useId, useState } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { copyOrDataText } from "../../core/copy.ts";
import type { CopyOrData } from "../../core/copy.ts";
import { buttonLookClassName } from "./Button.tsx";

import "./WordDetail.css";

/** A detail of more than one line, shown on asking: every element is phrasing
 * content, so it stands inside the paragraph an inline notice is. */
function WordDetailMore(props: { readonly said: string }): ReactNode {
  const text = useCopyText();
  const body = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      {" "}
      <button
        type="button"
        className={buttonLookClassName({ variant: "quiet", size: "sm" })}
        aria-expanded={open}
        aria-controls={body}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {text({ id: "ui-detail-more" })}
      </button>
      <span id={body} className="word-detail-more" hidden={!open}>
        {props.said}
      </span>
    </>
  );
}

export function WordDetail(props: {
  readonly word: ReactNode;
  readonly detail: CopyOrData | undefined;
}): ReactNode {
  const text = useCopyText();
  if (props.detail === undefined) return props.word;
  const said = copyOrDataText(text, props.detail);
  return (
    <>
      {props.word}
      {said.includes("\n") ? (
        <WordDetailMore said={said} />
      ) : (
        <span className="word-detail">{` · ${said}`}</span>
      )}
    </>
  );
}
