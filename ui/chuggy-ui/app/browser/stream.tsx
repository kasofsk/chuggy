import type { ReactNode } from "react";

export function ProjectStreamProvider(props: {
  readonly children: ReactNode;
  readonly partition?: unknown;
  readonly transport?: typeof fetch;
}): ReactNode {
  return props.children;
}
