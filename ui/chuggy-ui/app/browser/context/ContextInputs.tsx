/**
 * The Inputs section of a Context view: what the runtime was handed before its
 * first call. A run's lists its brief, the files it read and what its init
 * named; a session's, the block its thread was seeded with, the text appended
 * to the runtime's prompt and the window it was given.
 */

import { Fragment, useId, useState } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy } from "../../core/copy.ts";
import type {
  ContextFile,
  ContextFileGroup,
  ContextInputs,
  ContextNames,
} from "../../core/contextInputs.ts";
import type { ContextSessionInputs } from "../../core/contextSession.ts";
import { groupedDigits } from "../../core/figures.ts";
import { Button } from "../ui/Button.tsx";
import { Chevron } from "../ui/Chevron.tsx";
import { Table } from "../ui/Table.tsx";

/** A long text folded to its first lines, with Show to read the rest. */
function ContextFolded(props: {
  readonly name: Copy;
  readonly body: string;
}): ReactNode {
  const text = useCopyText();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <>
      <div className="context-brief-head">
        <h4 className="context-subtitle">{text(props.name)}</h4>
        <span className="context-muted">
          {groupedDigits(props.body.length)}{" "}
          {text({ id: "context-characters" })}
        </span>
        <Button
          size="sm"
          variant="quiet"
          expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {text({ id: open ? "context-hide" : "context-show" })}
        </Button>
      </div>
      <pre className="context-brief" id={bodyId} data-open={open}>
        {props.body}
      </pre>
    </>
  );
}

const contextFileGroupWords: Record<ContextFileGroup, Copy> = {
  Instructions: { id: "context-instructions" },
  Settings: { id: "context-settings" },
  Other: { id: "context-files-other" },
};

/** A path that may break after each of its slashes, and nowhere inside a
 * segment unless one is wider than the column. */
function pathBreakable(path: string): ReactNode {
  return path.split("/").map((segment, index) => (
    <Fragment key={index}>
      {index === 0 ? null : (
        <>
          /<wbr />
        </>
      )}
      {segment}
    </Fragment>
  ));
}

function ContextFileRow(props: { readonly file: ContextFile }): ReactNode {
  const text = useCopyText();
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const { file } = props;
  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="context-file-toggle"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => {
              setOpen(!open);
            }}
          >
            <Chevron className="context-file-chevron" />
            <span>{pathBreakable(file.path)}</span>
          </button>
        </td>
        <td className="num">
          {file.tokens === undefined ? "—" : groupedDigits(file.tokens)}
        </td>
        <td className="num">{groupedDigits(file.bytes)}</td>
      </tr>
      {open ? (
        <tr id={contentId}>
          <td colSpan={3} className="context-file-open">
            {file.content === undefined ? (
              <span className="context-muted">
                {text({ id: "context-file-unkept" })}
              </span>
            ) : (
              <pre className="context-file-content">{file.content}</pre>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ContextFiles(props: {
  readonly files: readonly ContextFile[];
}): ReactNode {
  const text = useCopyText();
  const groups = (["Instructions", "Settings", "Other"] as const).filter(
    (group) => props.files.some((file) => file.group === group),
  );
  return (
    <div className="context-files">
      <Table>
        <thead>
          <tr>
            <th scope="col">{text({ id: "context-col-file" })}</th>
            <th scope="col" className="num">
              {text({ id: "context-col-tokens" })}
            </th>
            <th scope="col" className="num">
              {text({ id: "context-col-bytes" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group}>
              <tr>
                <th scope="rowgroup" colSpan={3}>
                  {text(contextFileGroupWords[group])}
                </th>
              </tr>
              {props.files
                .filter((file) => file.group === group)
                .map((file) => (
                  <ContextFileRow key={file.path} file={file} />
                ))}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function ContextNamesRow(props: {
  readonly name: Copy;
  readonly names: ContextNames | undefined;
}): ReactNode {
  const text = useCopyText();
  const { names } = props;
  if (names === undefined) return null;
  return (
    <div>
      <dt>{text(props.name)}</dt>
      <dd>
        {names.names.length === 0 ? (
          <span>{text({ id: "context-none" })}</span>
        ) : (
          <>
            <span className="context-names-count">
              <strong>{groupedDigits(names.names.length)}</strong>
              {names.tokens === undefined ? null : (
                <span className="context-muted">
                  {text({
                    id: "context-tokens",
                    args: { tokens: groupedDigits(names.tokens) },
                  })}
                  {names.deferred === undefined
                    ? null
                    : ` · ${text({ id: "context-deferred-count", args: { tokens: groupedDigits(names.deferred) } })}`}
                </span>
              )}
            </span>
            <span className="context-names-list">{names.names.join(", ")}</span>
          </>
        )}
      </dd>
    </div>
  );
}

export function ContextRunInputsSection(props: {
  readonly inputs: ContextInputs | undefined;
}): ReactNode {
  const text = useCopyText();
  const titleId = useId();
  const { inputs } = props;
  return (
    <section className="context-section" aria-labelledby={titleId}>
      <header className="context-head">
        <h3 className="context-title" id={titleId}>
          {text({ id: "context-inputs-title" })}
        </h3>
        {inputs === undefined ? null : (
          <span className="context-meta">
            {text({ id: "context-snapshot" })}
          </span>
        )}
      </header>
      {inputs === undefined ? (
        <p className="context-muted">{text({ id: "context-inputs-none" })}</p>
      ) : (
        <>
          {inputs.brief === undefined ? (
            <p className="context-muted">
              {text({ id: "context-brief-none" })}
            </p>
          ) : (
            <ContextFolded name={{ id: "context-brief" }} body={inputs.brief} />
          )}
          {inputs.files.length === 0 ? null : (
            <ContextFiles files={inputs.files} />
          )}
          <dl className="context-names">
            <ContextNamesRow
              name={{ id: "context-tools" }}
              names={inputs.tools}
            />
            <ContextNamesRow
              name={{ id: "context-mcp-servers" }}
              names={inputs.mcpServers}
            />
            <ContextNamesRow
              name={{ id: "context-skills" }}
              names={inputs.skills}
            />
            <ContextNamesRow
              name={{ id: "context-agents" }}
              names={inputs.agents}
            />
            <ContextNamesRow
              name={{ id: "context-plugins" }}
              names={inputs.plugins}
            />
          </dl>
        </>
      )}
    </section>
  );
}

/** One row of a session's Inputs: a text by its length, with Show to read it. */
function ContextSessionFolded(props: {
  readonly name: Copy;
  readonly body: string;
}): ReactNode {
  const text = useCopyText();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <dt>{text(props.name)}</dt>
      <dd>
        {groupedDigits(props.body.length)}{" "}
        <span className="context-muted">
          {text({ id: "context-characters" })}
        </span>
      </dd>
      <dd>
        <Button
          size="sm"
          variant="quiet"
          expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {text({ id: open ? "context-hide" : "context-show" })}
        </Button>
      </dd>
      {open ? (
        <dd className="context-brief" data-open="true">
          {props.body}
        </dd>
      ) : null}
    </div>
  );
}

export function ContextSessionInputsSection(props: {
  readonly inputs: ContextSessionInputs;
}): ReactNode {
  const text = useCopyText();
  const titleId = useId();
  const { inputs } = props;
  const empty =
    inputs.seed === undefined &&
    inputs.prompt === undefined &&
    inputs.window === undefined;
  return (
    <section className="context-section" aria-labelledby={titleId}>
      <header className="context-head">
        <h3 className="context-title" id={titleId}>
          {text({ id: "context-inputs-title" })}
        </h3>
      </header>
      {empty ? (
        <p className="context-muted">{text({ id: "context-inputs-none" })}</p>
      ) : (
        <dl className="context-session-inputs">
          {inputs.seed === undefined ? null : (
            <ContextSessionFolded
              name={{ id: "context-thread-seed" }}
              body={inputs.seed}
            />
          )}
          {inputs.prompt === undefined ? null : (
            <ContextSessionFolded
              name={{ id: "context-appended-prompt" }}
              body={inputs.prompt}
            />
          )}
          {inputs.window === undefined ? null : (
            <div>
              <dt>{text({ id: "context-category-window" })}</dt>
              <dd>
                {groupedDigits(inputs.window)}{" "}
                <span className="context-muted">
                  {text({ id: "context-used-alone" })}
                </span>
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
