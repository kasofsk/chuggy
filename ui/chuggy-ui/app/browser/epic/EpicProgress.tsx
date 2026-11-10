/**
 * How far an epic's tickets have come: its status chip, and a slim bar with a
 * segment for each group of its members, Done first, then Running, Escalated
 * and Pending, each in its group's tone, Pending in the track's. An empty
 * epic draws no bar.
 *
 * The bar is an SVG, so a segment is as wide as its share without a `style`
 * attribute the served policy refuses. Under the bar on the page a key names
 * each group with its count; in a list's row the bar has its words beside it.
 * Nothing moves.
 */

import type { ReactNode } from "react";

import type { EpicSummaryResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  epicProgressSaid,
  epicProgressSegments,
  epicStatusLook,
} from "../../core/epics.ts";
import type { EpicProgressSegment } from "../../core/epics.ts";
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

/** What the bar says, each part in words, joined as a sentence or a line. */
function useEpicProgressSaid(
  progress: EpicProgressFigures,
  joint: string,
): string {
  const text = useCopyText();
  return epicProgressSaid(progress)
    .map((part) => text(part))
    .join(joint);
}

/** The track and a segment for each group with members. */
function EpicProgressTrack(props: {
  readonly segments: readonly EpicProgressSegment[];
}): ReactNode {
  return (
    <svg className="epic-progress-track" aria-hidden="true">
      {props.segments.map((segment) => (
        <rect
          key={segment.group}
          className="epic-progress-segment"
          data-group={segment.group}
          data-tone={segment.tone}
          x={`${String(segment.startPercent)}%`}
          width={`${String(segment.sharePercent)}%`}
          height="100%"
        />
      ))}
    </svg>
  );
}

/** The bar, read as a progress bar of the members done, named in words. */
function EpicProgressBar(props: {
  readonly progress: EpicProgressFigures;
  readonly segments: readonly EpicProgressSegment[];
}): ReactNode {
  const said = useEpicProgressSaid(props.progress, ", ");
  return (
    <div
      className="epic-progress-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={props.progress.total}
      aria-valuenow={props.progress.done}
      aria-label={said}
      title={said}
    >
      <EpicProgressTrack segments={props.segments} />
    </div>
  );
}

/** A swatch, the count and the word for each group with members. */
function EpicProgressKey(props: {
  readonly segments: readonly EpicProgressSegment[];
}): ReactNode {
  const text = useCopyText();
  return (
    <ul
      className="epic-progress-key"
      aria-label={text({ id: "epics-progress-key" })}
    >
      {props.segments.map((segment) => (
        <li key={segment.group} data-group={segment.group}>
          <svg className="epic-progress-swatch" aria-hidden="true">
            <rect
              className="epic-progress-segment"
              data-tone={segment.tone}
              width="100%"
              height="100%"
            />
          </svg>
          <span className="epic-progress-count num">{segment.count}</span>
          <span>{text(segment.word)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The header's bar, the page's full width, with its key under it. */
export function EpicProgressPage(props: {
  readonly progress: EpicProgressFigures;
}): ReactNode {
  const segments = epicProgressSegments(props.progress);
  if (segments.length === 0) return null;
  return (
    <div className="epic-progress" data-size="page">
      <EpicProgressBar progress={props.progress} segments={segments} />
      <EpicProgressKey segments={segments} />
    </div>
  );
}

/** A list row's bar, with what it says beside it. */
export function EpicProgressRow(props: {
  readonly progress: EpicProgressFigures;
}): ReactNode {
  const segments = epicProgressSegments(props.progress);
  const said = useEpicProgressSaid(props.progress, " · ");
  return (
    <div className="epic-progress" data-size="row">
      {segments.length === 0 ? null : (
        <EpicProgressBar progress={props.progress} segments={segments} />
      )}
      <span className="epic-progress-said">{said}</span>
    </div>
  );
}
