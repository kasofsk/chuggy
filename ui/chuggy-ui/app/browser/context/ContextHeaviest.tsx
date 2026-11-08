/**
 * The Heaviest section of a run's Context view: its tool results summed by
 * tool, with each tool's share of the context, and the largest of them, each
 * naming the call it was asked in and how far the context grew after it.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type {
  ContextHeaviest,
  ContextResult,
  ContextToolRow,
} from "../../core/contextResults.ts";
import { groupedDigits } from "../../core/figures.ts";
import { Figure } from "../ui/Figure.tsx";
import { Table } from "../ui/Table.tsx";

function ContextMeter(props: { readonly row: ContextToolRow }): ReactNode {
  const { row } = props;
  if (row.share === undefined || row.fraction === undefined) return null;
  const filled = `${String(Math.min(Math.max(row.fraction, 0.004), 1) * 100)}%`;
  return (
    <span className="context-meter">
      <Figure figure={row.share} />
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

function ContextByTool(props: {
  readonly heaviest: ContextHeaviest;
}): ReactNode {
  const text = useCopyText();
  const { heaviest } = props;
  return (
    <>
      <h4 className="context-subtitle">{text({ id: "context-by-tool" })}</h4>
      <Table>
        <thead>
          <tr>
            <th scope="col">{text({ id: "context-col-tool" })}</th>
            <th scope="col" className="num">
              {text({ id: "context-col-calls" })}
            </th>
            <th scope="col" className="num">
              {text({
                id: heaviest.exact ? "context-col-tokens" : "context-col-bytes",
              })}
            </th>
            <th scope="col" className="num">
              {text({ id: "context-col-share" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {heaviest.tools.map((row) => {
            const weight = heaviest.exact ? row.tokens : row.bytes;
            return (
              <tr key={row.tool}>
                <td>{row.tool}</td>
                <td className="num">
                  {row.calls === undefined ? "—" : groupedDigits(row.calls)}
                </td>
                <td className="num">
                  {weight === undefined ? "—" : groupedDigits(weight)}
                </td>
                <td className="num">
                  <ContextMeter row={row} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="context-note">
        {text({
          id: heaviest.exact
            ? "context-share-exact"
            : "context-share-estimated",
        })}
      </p>
    </>
  );
}

/** What a result whose call is counted is drawn as: a link to the
 * transcript's step that asked it, by the result's own `tool_use_id`. */
export type ContextCallLink = (
  result: ContextResult & { readonly call: number },
) => ReactNode;

function ContextLargest(props: {
  readonly results: readonly ContextResult[];
  readonly callLink: ContextCallLink;
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      <h4 className="context-subtitle">{text({ id: "context-largest" })}</h4>
      <ol className="context-largest">
        {props.results.map((result) => (
          <li key={result.id}>
            <span>
              {result.call === undefined ? (
                <span className="context-muted">
                  {text({ id: "context-result-uncounted" })}
                </span>
              ) : (
                props.callLink({ ...result, call: result.call })
              )}
            </span>
            <span className="context-largest-tool">{result.tool}</span>
            <span className="context-largest-input" title={result.input}>
              {result.input}
            </span>
            <span className="num">
              {groupedDigits(result.bytes)}{" "}
              <span className="context-muted">
                {text({ id: "context-bytes" })}
              </span>
            </span>
            <span className="num context-muted">
              {result.growth === undefined || result.growth < 0
                ? null
                : text({
                    id: "context-growth-after",
                    args: { tokens: groupedDigits(result.growth) },
                  })}
            </span>
          </li>
        ))}
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
        {heaviest.results === 0 ? null : (
          <span className="context-meta">
            {text({ id: "context-results", args: { count: heaviest.results } })}
          </span>
        )}
      </header>
      {heaviest.tools.length === 0 ? (
        <p className="context-muted">{text({ id: "context-heaviest-none" })}</p>
      ) : (
        <ContextByTool heaviest={heaviest} />
      )}
      {heaviest.largest.length === 0 ? null : (
        <ContextLargest results={heaviest.largest} callLink={props.callLink} />
      )}
    </section>
  );
}
