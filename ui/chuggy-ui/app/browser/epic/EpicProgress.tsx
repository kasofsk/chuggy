/**
 * How far an epic's tickets have come: its status chip, a slim bar with the
 * figure beside it, and a chip for each phase its members are in.
 *
 * The bar is an SVG, so its fill is as wide as the share done without a
 * `style` attribute the served policy refuses. While any member moves on its
 * own the fill shimmers, or, with nothing done yet, the empty track sweeps;
 * both are the sheet's keyframes, timed off tokens reduced motion zeroes.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import type { EpicSummaryResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { phaseLabel } from "../../core/codeLabels.ts";
import {
  epicProgressBar,
  epicProgressCounts,
  epicProgressLine,
  epicProgressMovingAny,
  epicStatusLook,
} from "../../core/epics.ts";
import { phaseTone } from "../../core/tones.ts";
import { Pill } from "../ui/Pill.tsx";

import "./epic.css";

type EpicProgressFigures = EpicSummaryResponse["progress"];

export function EpicStatusChip(props: {
  readonly status: EpicSummaryResponse["status"];
}): ReactNode {
  const text = useCopyText();
  const look = epicStatusLook(props.status);
  return <Pill tone={look.tone}>{text(look.word)}</Pill>;
}

/** The track, its fill, and the highlight that says something is moving. */
function EpicProgressTrack(props: {
  readonly progress: EpicProgressFigures;
}): ReactNode {
  const clip = `epic-progress-${useId().replace(/[^a-zA-Z0-9-]/gu, "")}`;
  const bar = epicProgressBar(props.progress);
  const share = `${String(bar.sharePercent)}%`;
  return (
    <svg
      className="epic-progress-track"
      data-moving={bar.moving}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clip}>
          <rect
            width={bar.moving === "Sweep" ? "100%" : share}
            height="100%"
            rx="3"
          />
        </clipPath>
      </defs>
      <rect
        className="epic-progress-ground"
        width="100%"
        height="100%"
        rx="3"
      />
      <rect className="epic-progress-fill" width={share} height="100%" rx="3" />
      {bar.moving === "Still" ? null : (
        <g clipPath={`url(#${clip})`}>
          <rect
            className="epic-progress-glint"
            x="-40%"
            width="40%"
            height="100%"
          />
        </g>
      )}
    </svg>
  );
}

/** The bar and its `done/total`, read as a progress bar named in words. */
export function EpicProgressBar(props: {
  readonly progress: EpicProgressFigures;
  readonly size: "row" | "page";
}): ReactNode {
  const text = useCopyText();
  const { progress } = props;
  const said = text(epicProgressLine(progress));
  return (
    <span
      className="epic-progress"
      data-size={props.size}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={progress.done}
      aria-label={said}
      aria-busy={epicProgressMovingAny(progress) || undefined}
      title={said}
    >
      <EpicProgressTrack progress={progress} />
      <span className="epic-progress-figure num">
        {`${String(progress.done)}/${String(progress.total)}`}
      </span>
    </span>
  );
}

/** A chip for each phase at least one member is in, none for an empty epic. */
export function EpicProgressCounts(props: {
  readonly progress: EpicProgressFigures;
}): ReactNode {
  const text = useCopyText();
  const counts = epicProgressCounts(props.progress);
  if (counts.length === 0) return null;
  return (
    <span className="epic-progress-counts">
      {counts.map(({ phase, count }) => (
        <Pill key={phase} tone={phaseTone(phase)}>
          {text({
            id: "epics-progress-count",
            args: { count: String(count), phase: text(phaseLabel(phase)) },
          })}
        </Pill>
      ))}
    </span>
  );
}

/** The status, the bar and the counts, as a row of the list or a page's
 * header draws them. */
export function EpicStanding(props: {
  readonly epic: Pick<EpicSummaryResponse, "status" | "progress">;
  readonly size: "row" | "page";
}): ReactNode {
  return (
    <span className="epic-standing" data-size={props.size}>
      <EpicStatusChip status={props.epic.status} />
      <EpicProgressBar progress={props.epic.progress} size={props.size} />
      <EpicProgressCounts progress={props.epic.progress} />
    </span>
  );
}
