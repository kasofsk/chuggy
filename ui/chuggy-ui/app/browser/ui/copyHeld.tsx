/**
 * How a copy control puts text on the clipboard.
 *
 * A PRIMITIVE PERFORMS NOTHING, and writing to the clipboard is something
 * performed, so the write arrives here from whoever mounts the console and the
 * control only asks for it. It sits where a control cannot be handed anything:
 * under a code block, under a list, under an answer.
 *
 * IT IS OPTIONAL, AND WITH NOTHING HELD NO CONTROL IS DRAWN. A report mounted
 * in a suite with no provider is a report nobody can copy from, which is the
 * truth of it.
 */

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/** Puts text on the clipboard, answering whether the browser allowed it. */
export type CopyWrite = (text: string) => Promise<boolean>;

const copyContext = createContext<CopyWrite | undefined>(undefined);

export function CopyProvider(props: {
  readonly write: CopyWrite;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <copyContext.Provider value={props.write}>
      {props.children}
    </copyContext.Provider>
  );
}

export function useCopyHeld(): CopyWrite | undefined {
  return useContext(copyContext);
}
