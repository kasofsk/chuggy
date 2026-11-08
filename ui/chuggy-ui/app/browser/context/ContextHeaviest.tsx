/**
 * The Heaviest section of a run's Context view: what each tool put in the
 * context, with its share of it, and the calls the context grew into most,
 * each with the tool call whose result it was the first to read where the
 * pane holds that call.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type {
  ContextByTool,
  ContextHeaviest,
  ContextLargestRow,
  ContextToolEstimated,
  ContextToolRead,
} from "../../core/contextResults.ts";
import { contextAtLabel } from "../../core/contextView.ts";
import { groupedDigits } from "../../core/figures.ts";
import type { Figure as FigureValue } from "../../core/figures.ts";
import { Figure } from "../ui/Figure.tsx";
import { Table } from "../ui/Table.tsx";

function ContextMeter(props: {
  readonly share: FigureValue | undefined;
  readonly fraction: number | undefined;
}): ReactNode {
  const { share, fraction } = props;
  if (share === undefined || fraction === undefined) return null;
  const filled = `${String(Math.min(Math.max(fraction, 0.004), 1) * 100)}%`;
  return (
    <span className="context-meter">
      <Figure figure={share} />
      <svg aria-hidden="true">
        <rect
          className="context-meter-track"
          x="0"
          y="0"
          width="100%"
          height="100%"
          rx="2"
        />
        <rect
          className="context-meter-fill"
          x="0"
          y="0"
          width={filled}
          height="100%"
          rx="2"
        />
      </svg>
    </span>
  );
}

/** By tool as a reading weighed it: each tool's tokens, calls and results
 * together, and their share of the context it read. */
function ContextByToolRead(props: {
  readonly tools: readonly ContextToolRead[];
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      <h4 className="context-subtitle">{text({ id: "context-by-tool" })}</h4>
      <Table>
        <thead>
          <tr>
            <th scope="col">{text({ id: "context-col-tool" })}</th>
            <th scope="col" className="num">
              {text({ id: "context-col-tokens" })}
            </th>
            <th scope="col" className="num">
              {text({ id: "context-col-share" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.tools.map((row) => (
            <tr key={row.tool}>
              <td>{row.tool}</td>
              <td className="num">{groupedDigits(row.tokens)}</td>
              <td className="num">
                <ContextMeter share={row.share} fraction={row.fraction} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="context-note">{text({ id: "context-share-exact" })}</p>
    </>
  );
}

function ContextByToolEstimatedRows(props: {
  readonly tools: readonly ContextToolEstimated[];
}): ReactNode {
  const text = useCopyText();
  return (
    <Table>
      <thead>
        <tr>
          <th scope="col">{text({ id: "context-col-tool" })}</th>
          <th scope="col" className="num">
            {text({ id: "context-col-calls" })}
          </th>
          <th scope="col" className="num">
            {text({ id: "context-col-bytes" })}
          </th>
          <th scope="col" className="num">
            {text({ id: "context-col-share" })}
          </th>
        </tr>
      </thead>
      <tbody>
        {props.tools.map((row) => (
          <tr key={row.tool}>
            <td>{row.tool}</td>
            <td className="num">{groupedDigits(row.results)}</td>
            <td className="num">
              {row.bytes === undefined ? "—" : groupedDigits(row.bytes)}
            </td>
            <td className="num">
              <ContextMeter share={row.share} fraction={row.fraction} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** By tool estimated from the results the pane holds, its head saying how
 * many it counted and its notes how many it left out. */
function ContextByToolEstimated(props: {
  readonly byTool: Extract<ContextByTool, { from: "Transcript" }>;
}): ReactNode {
  const text = useCopyText();
  const { byTool } = props;
  return (
    <>
      <div className="context-head">
        <h4 className="context-subtitle">{text({ id: "context-by-tool" })}</h4>
        {byTool.results === 0 ? null : (
          <span className="context-meta">
            {text({
              id: byTool.latestOnly
                ? "context-results-latest"
                : "context-results",
              args: { count: byTool.results },
            })}
          </span>
        )}
      </div>
      {byTool.tools.length === 0 ? null : (
        <>
          <ContextByToolEstimatedRows tools={byTool.tools} />
          <p className="context-note">
            {text({ id: "context-share-estimated" })}
          </p>
        </>
      )}
      {byTool.unweighed ? (
        <p className="context-note">
          {text({ id: "context-share-unweighed" })}
        </p>
      ) : null}
      {byTool.unasked === 0 ? null : (
        <p className="context-note">
          {text({
            id: "context-results-unasked",
            args: { count: byTool.unasked },
          })}
        </p>
      )}
    </>
  );
}

function ContextByToolPart(props: {
  readonly byTool: ContextByTool;
}): ReactNode {
  const text = useCopyText();
  const { byTool } = props;
  switch (byTool.from) {
    case "Reading":
      return <ContextByToolRead tools={byTool.tools} />;
    case "Transcript":
      return byTool.tools.length === 0 && byTool.unasked === 0 ? (
        <p className="context-muted">{text({ id: "context-heaviest-none" })}</p>
      ) : (
        <ContextByToolEstimated byTool={byTool} />
      );
  }
}

/** A largest call, as a link to the transcript's step that holds the tool
 * call whose result it was the first to read, by that call's own id. */
export type ContextCallLink = (link: {
  readonly call: number;
  readonly step: string;
}) => ReactNode;

function ContextLargestCall(props: {
  readonly row: ContextLargestRow;
  readonly callLink: ContextCallLink;
}): ReactNode {
  const text = useCopyText();
  const { row } = props;
  return (
    <span className="context-largest-at">
      {row.asked === undefined
        ? text(contextAtLabel("Call", row.call))
        : props.callLink({ call: row.call, step: row.asked.id })}
      {row.series === "Subagent" ? (
        <>
          {" "}
          <span className="context-muted">
            {text({ id: "context-largest-subagent" })}
          </span>
        </>
      ) : null}
    </span>
  );
}

function ContextLargest(props: {
  readonly rows: readonly ContextLargestRow[];
  readonly callLink: ContextCallLink;
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      <h4 className="context-subtitle">{text({ id: "context-largest" })}</h4>
      <ol className="context-largest">
        {props.rows.map((row) => {
          const bytes = row.asked?.result?.bytes;
          return (
            <li key={row.call} data-series={row.series}>
              <ContextLargestCall row={row} callLink={props.callLink} />
              <span className="context-largest-tool">{row.asked?.tool}</span>
              <span className="context-largest-input" title={row.asked?.input}>
                {row.asked?.input}
              </span>
              <span className="num context-largest-bytes">
                {bytes === undefined ? null : (
                  <>
                    {groupedDigits(bytes)}{" "}
                    <span className="context-muted">
                      {text({ id: "context-bytes" })}
                    </span>
                  </>
                )}
              </span>
              <span className="num context-muted context-largest-growth">
                {text({
                  id: "context-growth-into",
                  args: { tokens: groupedDigits(row.growth) },
                })}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function ContextHeaviestSection(props: {
  readonly heaviest: ContextHeaviest;
  readonly callLink: ContextCallLink;
}): ReactNode {
  const text = useCopyText();
  const titleId = useId();
  const { heaviest } = props;
  return (
    <section className="context-section" aria-labelledby={titleId}>
      <header className="context-head">
        <h3 className="context-title" id={titleId}>
          {text({ id: "context-heaviest-title" })}
        </h3>
        {heaviest.calls === 0 ? null : (
          <span className="context-meta">
            {text({
              id: "context-heaviest-calls",
              args: { count: heaviest.calls },
            })}
          </span>
        )}
      </header>
      <ContextByToolPart byTool={heaviest.byTool} />
      {heaviest.largest.length === 0 ? null : (
        <ContextLargest rows={heaviest.largest} callLink={props.callLink} />
      )}
    </section>
  );
}
