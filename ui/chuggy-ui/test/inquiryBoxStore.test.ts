/**
 * The store the boxes are held in for the life of the tab: what it tells whom,
 * and what it stops telling them.
 *
 * A LISTENER THAT CANNOT BE RELEASED IS A LEAK AND A LIE. Every screen that
 * reads this store subscribes on mount and releases on unmount, and the lead
 * page is unmounted by a click on any sibling screen — so a release that
 * removed nothing would leave one dead listener per visit, each told of every
 * later write, and the store would grow for as long as the tab is open.
 */

import { expect, test } from "vitest";

import { inquiryBoxStore } from "../app/browser/lead/inquiryBoxes.ts";
import { inquiryBoxTyped } from "../app/core/leadInquiries.ts";

const partition = { tenant: "acme", project: "atlas" };

function typing(store: ReturnType<typeof inquiryBoxStore>, said: string): void {
  store.write(partition, (box) => inquiryBoxTyped(box, said));
}

test("a write tells every listener, and one value stands for one change", () => {
  const store = inquiryBoxStore();
  let told = 0;
  store.subscribe(() => {
    told += 1;
  });
  const before = store.boxes();
  typing(store, "why");
  expect(told).toBe(1);
  expect(store.boxes()).not.toBe(before);
  expect(store.boxes()).toBe(store.boxes());
});

test("a listener that has been released is told nothing more", () => {
  const store = inquiryBoxStore();
  const heard: string[] = [];
  const release = store.subscribe(() => heard.push("released"));
  store.subscribe(() => heard.push("kept"));
  typing(store, "why");
  expect(heard).toStrictEqual(["released", "kept"]);
  release();
  typing(store, "why not");
  expect(heard, "a released listener was still told of a write").toStrictEqual([
    "released",
    "kept",
    "kept",
  ]);
});

/** Releasing twice is what a remount under a strict double-invoke does, and it
 * must not take the listener that replaced it. */
test("a release is idempotent and takes only its own listener", () => {
  const store = inquiryBoxStore();
  const heard: string[] = [];
  const release = store.subscribe(() => heard.push("first"));
  release();
  release();
  store.subscribe(() => heard.push("second"));
  typing(store, "why");
  expect(heard).toStrictEqual(["second"]);
});

/** The discard is the only thing besides an accepted send that empties a box,
 * and a reader of the store is told when it happens. */
test("a discard empties every box and tells the listeners", () => {
  const store = inquiryBoxStore();
  let told = 0;
  store.subscribe(() => {
    told += 1;
  });
  typing(store, "why");
  store.outstanding.take("one");
  expect(store.outstanding.taken("one")).toBe(true);
  store.discard();
  expect(store.boxes()).toStrictEqual({});
  expect(store.outstanding.taken("one")).toBe(false);
  expect(told).toBe(2);
});
