/**
 * What fails every case over the site, shown failing: a component's state set
 * while a different component renders, which React says once and only on the
 * console.
 */

import { render } from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { expect, test } from "vitest";

import { consoleSiteClean, consoleSiteEachCase } from "./consoleSite.tsx";
import type { ConsoleSite } from "./consoleSite.tsx";

let site: ConsoleSite;

consoleSiteEachCase((made) => {
  site = made;
});

function ConsoleSiteSetInRender(props: {
  readonly set: (value: number) => void;
}): ReactNode {
  props.set(1);
  return null;
}

function ConsoleSiteSetFromChild(): ReactNode {
  const [value, set] = useState(0);
  return (
    <>
      {value}
      <ConsoleSiteSetInRender set={set} />
    </>
  );
}

function ConsoleSiteSetOwnState(): ReactNode {
  const [value, set] = useState(0);
  if (value === 0) set(1);
  return value;
}

test("a state set while another component renders fails the case", () => {
  render(<ConsoleSiteSetFromChild />);
  expect(site.updatesInRender).toEqual([
    "ConsoleSiteSetFromChild while rendering ConsoleSiteSetInRender",
  ]);
  expect(() => {
    consoleSiteClean(site);
  }).toThrow("states set in another's render");
});

test("a component setting its own state in render passes", () => {
  render(<ConsoleSiteSetOwnState />);
  consoleSiteClean(site);
});
