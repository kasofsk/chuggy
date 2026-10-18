/** The mark a trigger turns as what it opens opens, pointing right while
 * closed; the stylesheet of whatever draws it says how it turns. */

import type { ReactNode } from "react";

export function Chevron(props: { readonly className: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`${props.className} size-3 shrink-0`}
    >
      <path
        d="M4 2 L8 6 L4 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
