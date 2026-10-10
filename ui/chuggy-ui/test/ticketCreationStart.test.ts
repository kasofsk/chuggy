/**
 * What a creation's press goes on to, over every answer of the two things it
 * turns on: whether the reader may dispatch, and whether the project's work
 * has a runner to go to. It starts work only where both are read to say so.
 */

import { expect, test } from "vitest";

import type { ProjectAbilityRead } from "../app/core/projectAbilities.ts";
import {
  creationStart,
  creationSubmitEffect,
  creationSubmitMotion,
} from "../app/core/ticketCreation.ts";
import type { CreationStart } from "../app/core/ticketCreation.ts";
import type { WorkRunner } from "../app/core/workRunner.ts";

const starts: readonly (readonly [
  ProjectAbilityRead,
  WorkRunner,
  CreationStart,
])[] = [
  ["Asked", "Clear", "Starts"],
  ["Asked", "NoRunner", "NoRunner"],
  ["Asked", "Held", "Waits"],
  ["Refused", "Clear", "Waits"],
  ["Refused", "NoRunner", "Waits"],
  ["Refused", "Held", "Waits"],
  ["Held", "Clear", "Waits"],
  ["Held", "NoRunner", "Waits"],
  ["Held", "Held", "Waits"],
];

test.each(starts)(
  "a dispatch read of %s over a runner read of %s is a press that %s",
  (dispatch, runner, start) => {
    expect(creationStart(dispatch, runner)).toBe(start);
  },
);

const words: readonly (readonly [CreationStart, string, string])[] = [
  ["Starts", "Starts work", "Start"],
  ["Waits", "Released for a dispatcher to start", "Release"],
  ["NoRunner", "No runner", "Release"],
];

test.each(words)(
  "a press that %s reads %j beside the button and makes the motion %s",
  (start, effect, motion) => {
    expect(creationSubmitEffect(start)).toBe(effect);
    expect(creationSubmitMotion(start)).toBe(motion);
  },
);
