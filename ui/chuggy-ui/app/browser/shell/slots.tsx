/**
 * The three places of the shell a page draws into from inside the router's
 * outlet: the top bar above it, the details aside beside it, the slot under it.
 *
 * A PORTAL RATHER THAN A REGISTERED NODE. What a page hands the shell here is
 * markup, and markup registered through an effect re-registers on every render
 * unless every caller memoises it — a contract a caller can only break by
 * looping forever. A portal keeps the content in the page's own subtree, so it
 * re-renders with the page and nothing has to hold it.
 *
 * The shell still has to know that a page filled a slot, because an unfilled
 * top bar draws the partition instead and an unfilled details slot draws no
 * toggle. That is a boolean, and a boolean is safe to register.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export const shellSlotNames = ["topBar", "details", "bottom"] as const;

export type ShellSlotName = (typeof shellSlotNames)[number];

/** The two slots a page can be said to have filled; the bottom slot is empty or
 * it is not, and nothing is drawn differently either way. */
export type ShellSlotFilled = "topBar" | "details";

type ShellSlotNodes = Readonly<Record<ShellSlotName, HTMLElement | null>>;

type ShellSlotHolders = Readonly<
  Record<ShellSlotName, (node: HTMLElement | null) => void>
>;

interface ShellSlotsFilled {
  readonly topBar: boolean;
  readonly details: boolean;
  readonly detailsOpen: boolean;
}

interface ShellSlotsHeld {
  readonly nodes: ShellSlotNodes;
  readonly holders: ShellSlotHolders;
  readonly filled: ShellSlotsFilled;
  readonly fill: (
    name: ShellSlotFilled,
    filled: boolean,
    openFirst: boolean,
  ) => void;
  readonly detailsShow: (open: boolean) => void;
}

const shellSlotsContext = createContext<ShellSlotsHeld | undefined>(undefined);

const shellSlotsUnfilled: ShellSlotsFilled = {
  topBar: false,
  details: false,
  detailsOpen: false,
};

function useShellSlotsHeld(): ShellSlotsHeld {
  const held = useContext(shellSlotsContext);
  if (held === undefined)
    throw new Error("a shell slot was drawn outside the shell");
  return held;
}

export function ShellSlots(props: { readonly children: ReactNode }): ReactNode {
  const [nodes, setNodes] = useState<ShellSlotNodes>({
    topBar: null,
    details: null,
    bottom: null,
  });
  const [filled, setFilled] = useState<ShellSlotsFilled>(shellSlotsUnfilled);
  const holders = useMemo<ShellSlotHolders>(() => {
    const holder =
      (name: ShellSlotName) =>
      (node: HTMLElement | null): void => {
        setNodes((held) =>
          held[name] === node ? held : { ...held, [name]: node },
        );
      };
    return {
      topBar: holder("topBar"),
      details: holder("details"),
      bottom: holder("bottom"),
    };
  }, []);
  const fill = useCallback(
    (name: ShellSlotFilled, taken: boolean, openFirst: boolean) => {
      setFilled((held) =>
        name === "topBar"
          ? { ...held, topBar: taken }
          : { ...held, details: taken, detailsOpen: taken && openFirst },
      );
    },
    [],
  );
  const detailsShow = useCallback((open: boolean) => {
    setFilled((held) => ({ ...held, detailsOpen: open }));
  }, []);
  const held = useMemo<ShellSlotsHeld>(
    () => ({ nodes, holders, filled, fill, detailsShow }),
    [nodes, holders, filled, fill, detailsShow],
  );
  return (
    <shellSlotsContext.Provider value={held}>
      {props.children}
    </shellSlotsContext.Provider>
  );
}

/** What the shell draws differently because a page filled a slot. */
export function useShellSlotsFilled(): ShellSlotsFilled {
  return useShellSlotsHeld().filled;
}

/** The shell's own attachment for one slot, which is a `ref` and nothing a
 * render reads. */
export function useShellSlotHolder(
  name: ShellSlotName,
): (node: HTMLElement | null) => void {
  return useShellSlotsHeld().holders[name];
}

export function useShellDetailsShow(): (open: boolean) => void {
  return useShellSlotsHeld().detailsShow;
}

function ShellSlotFill(props: {
  readonly name: ShellSlotFilled;
  readonly openFirst: boolean;
}): null {
  const fill = useShellSlotsHeld().fill;
  const name = props.name;
  const openFirst = props.openFirst;
  useEffect(() => {
    fill(name, true, openFirst);
    return () => {
      fill(name, false, openFirst);
    };
  }, [fill, name, openFirst]);
  return null;
}

function ShellSlotPortal(props: {
  readonly name: ShellSlotName;
  readonly children: ReactNode;
}): ReactNode {
  const node = useShellSlotsHeld().nodes[props.name];
  return node === null ? null : createPortal(props.children, node);
}

/** The page's own title and chips, drawn in the bar above it. */
export function TopBarSlot(props: { readonly children: ReactNode }): ReactNode {
  return (
    <>
      <ShellSlotFill name="topBar" openFirst={false} />
      <ShellSlotPortal name="topBar">{props.children}</ShellSlotPortal>
    </>
  );
}

/** What the page is about beside the page itself, behind the bar's toggle. */
export function DetailsSlot(props: {
  readonly children: ReactNode;
  readonly openFirst?: boolean | undefined;
}): ReactNode {
  return (
    <>
      <ShellSlotFill name="details" openFirst={props.openFirst === true} />
      <ShellSlotPortal name="details">{props.children}</ShellSlotPortal>
    </>
  );
}

/** The row under the scrolling page, which a composer is pinned to. */
export function BottomSlot(props: { readonly children: ReactNode }): ReactNode {
  return <ShellSlotPortal name="bottom">{props.children}</ShellSlotPortal>;
}
