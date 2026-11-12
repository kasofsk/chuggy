/**
 * A list of records, one row each, joined into one rounded block under the
 * bar that heads it, and a "show more" under the block. The pages a list has
 * read are rows of the one list, so a page's last row is no seam.
 *
 * A row is a title that is a link and a heading at the level its page needs,
 * a meta line under it with a trailing slot at its end, and a foot. The meta
 * line and the foot hold their height when they are empty, so every row is as
 * tall whatever it carries, and a skeleton row is as tall again, so a list
 * read in under its skeletons does not jump.
 */

import { createLink } from "@tanstack/react-router";
import type { LinkOptions } from "@tanstack/react-router";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { Button } from "./Button.tsx";

import "./RecordList.css";

export const recordRowLevels = [2, 3, 4, 5, 6] as const;

export type RecordRowLevel = (typeof recordRowLevels)[number];

export interface RecordListMore {
  readonly label: string;
  readonly onMore: () => void;
  readonly busy?: boolean;
}

export function RecordList(props: {
  readonly label: string;
  readonly children: ReactNode;
  /** The next page, while there is one to read. */
  readonly more?: RecordListMore | undefined;
}): ReactNode {
  const more = props.more;
  return (
    <div className="record-list-frame">
      <ul className="record-list" aria-label={props.label}>
        {props.children}
      </ul>
      {more === undefined ? null : (
        <div className="record-list-more">
          <Button onClick={more.onMore} busy={more.busy ?? false}>
            {more.label}
          </Button>
        </div>
      )}
    </div>
  );
}

function RecordRowAnchor(props: ComponentPropsWithoutRef<"a">): ReactNode {
  return <a {...props} />;
}

const RecordRowLink = createLink(RecordRowAnchor);

export function RecordRow(props: {
  readonly title: string;
  readonly link: LinkOptions;
  readonly level: RecordRowLevel;
  readonly meta?: ReactNode;
  /** What stands at the meta line's end. */
  readonly trailing?: ReactNode;
  readonly foot?: ReactNode;
}): ReactNode {
  const Heading = `h${props.level}` as const;
  return (
    <li className="record-list-item">
      <article className="record-row">
        <div className="record-row-head">
          <Heading className="record-row-title">
            <RecordRowLink {...props.link}>{props.title}</RecordRowLink>
          </Heading>
          <div className="record-row-line">
            <span className="record-row-meta">{props.meta}</span>
            {props.trailing === undefined ? null : (
              <span className="record-row-trailing">{props.trailing}</span>
            )}
          </div>
        </div>
        <div className="record-row-foot">{props.foot}</div>
      </article>
    </li>
  );
}

/** A row's shape with nothing read into it, which no reader is told about. */
export function RecordRowSkeleton(): ReactNode {
  return (
    <li className="record-list-item" aria-hidden="true">
      <div className="record-row" data-skeleton="">
        <div className="record-row-head">
          <div className="record-row-title">
            <span className="record-row-bone" />
          </div>
          <div className="record-row-line">
            <span className="record-row-meta">
              <span className="record-row-bone" />
            </span>
          </div>
        </div>
        <div className="record-row-foot" />
      </div>
    </li>
  );
}
