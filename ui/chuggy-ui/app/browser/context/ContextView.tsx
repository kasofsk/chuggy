/**
 * The Context view: what an agent's model held, drawn the same for a run's tab
 * and a session's panel from the shapes `app/core` derives for either.
 *
 * A run's is the full form — its window, its growth per call with tiles, its
 * inputs and its heaviest results. A session's is the compact form beside a
 * conversation: its window, its growth per turn, and its inputs.
 */

import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { ContextInputs } from "../../core/contextInputs.ts";
import type {
  ContextHeaviest,
  ContextResult,
} from "../../core/contextResults.ts";
import type { ContextSessionInputs } from "../../core/contextSession.ts";
import type {
  ContextGrowthView,
  ContextTile,
  ContextWindowView,
} from "../../core/contextView.ts";
import { ContextGrowthSection } from "./ContextGrowth.tsx";
import { ContextHeaviestSection } from "./ContextHeaviest.tsx";
import {
  ContextRunInputsSection,
  ContextSessionInputsSection,
} from "./ContextInputs.tsx";
import { ContextWindowSection } from "./ContextWindow.tsx";

import "./context.css";

export interface ContextRunDrawn {
  readonly window: ContextWindowView;
  readonly growth: ContextGrowthView;
  readonly tiles: readonly ContextTile[];
  readonly inputs: ContextInputs | undefined;
  readonly heaviest: ContextHeaviest;
}

export function ContextRunView(props: {
  readonly drawn: ContextRunDrawn;
  readonly callLink: (result: ContextResult) => ReactNode;
}): ReactNode {
  const text = useCopyText();
  const { drawn } = props;
  return (
    <div
      className="context-view"
      role="region"
      aria-label={text({ id: "context-view-label" })}
    >
      <ContextWindowSection view={drawn.window} />
      <ContextGrowthSection view={drawn.growth} tiles={drawn.tiles} />
      <ContextRunInputsSection inputs={drawn.inputs} />
      <ContextHeaviestSection
        heaviest={drawn.heaviest}
        callLink={props.callLink}
      />
    </div>
  );
}

export interface ContextSessionDrawn {
  readonly window: ContextWindowView;
  readonly growth: ContextGrowthView;
  readonly inputs: ContextSessionInputs;
}

export function ContextSessionView(props: {
  readonly drawn: ContextSessionDrawn;
}): ReactNode {
  const { drawn } = props;
  return (
    <div className="context-view" data-compact="true">
      <ContextWindowSection view={drawn.window} />
      <ContextGrowthSection view={drawn.growth} tiles={undefined} />
      <ContextSessionInputsSection inputs={drawn.inputs} />
    </div>
  );
}
