/**
 * A project's mark at a named size: the icon it names, drawn by the read
 * `ProjectImage.tsx` makes of it, or, where it names none or its icon cannot
 * be drawn, its initial on the tint `core/projectMark.ts` picks for its name.
 *
 * The box is the size's whatever is in it, so the page does not move as the
 * icon arrives. Beside the project's drawn name the mark says nothing; where
 * it stands for the name, the name is what it says.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { projectMarkInitial, projectMarkTint } from "../core/projectMark.ts";
import type { ProjectMarkSize } from "../core/projectMark.ts";
import { useProjectImageSource } from "./ProjectImage.tsx";

import "./ProjectMark.css";

interface ProjectMarkDrawn {
  readonly name: string;
  readonly size: ProjectMarkSize;
  readonly alone: boolean;
}

/** What the box says: the name where the mark stands for it, and nothing
 * beside it. */
function projectMarkSaid(
  drawn: ProjectMarkDrawn,
): Readonly<Record<string, string>> {
  return drawn.alone
    ? { role: "img", "aria-label": drawn.name }
    : { "aria-hidden": "true" };
}

function ProjectMarkInitial(props: ProjectMarkDrawn): ReactNode {
  return (
    <span
      className={`project-mark project-mark-${props.size}`}
      data-tint={projectMarkTint(props.name)}
      translate="no"
      {...projectMarkSaid(props)}
    >
      {projectMarkInitial(props.name)}
    </span>
  );
}

function ProjectMarkIcon(
  props: ProjectMarkDrawn & {
    readonly partition: PartitionIdentity;
    readonly icon: string;
  },
): ReactNode {
  const read = useProjectImageSource(props.partition, props.icon);
  const [broken, setBroken] = useState(false);
  if (read.failed || broken) return <ProjectMarkInitial {...props} />;
  const box = `project-mark project-mark-${props.size}`;
  if (read.src === undefined)
    return <span className={box} {...projectMarkSaid(props)} />;
  return (
    <span className={box}>
      <img
        src={read.src}
        alt={props.alone ? props.name : ""}
        decoding="async"
        onError={() => {
          setBroken(true);
        }}
      />
    </span>
  );
}

export function ProjectMark(props: {
  readonly partition: PartitionIdentity;
  readonly name: string;
  /** The artifact the project names its icon, where it names one. */
  readonly icon: string | undefined;
  readonly size: ProjectMarkSize;
  /** The name is not drawn beside it, so the mark is what names the project. */
  readonly alone?: boolean;
}): ReactNode {
  const drawn = {
    name: props.name,
    size: props.size,
    alone: props.alone === true,
  };
  return props.icon === undefined ? (
    <ProjectMarkInitial {...drawn} />
  ) : (
    <ProjectMarkIcon
      key={props.icon}
      {...drawn}
      partition={props.partition}
      icon={props.icon}
    />
  );
}
