/**
 * What the Context suites draw from: a run's rows and readings, its snapshot,
 * the lines of its transcript, and a session's readings by turn, each in the
 * shape its contract answers it.
 */

import type {
  RunContextReading,
  RunContextWindow,
  RunTurnsResponse,
  SessionContextResponse,
} from "../../../src/contract/responses.ts";
import type { RunConfigurationSnapshot } from "../app/core/runConfiguration.ts";

export type RunTurnRowFixture = RunTurnsResponse["turns"][number];

export const contextRecordedAt = "2026-11-08T10:00:00.000Z";

/** One recorded row of a run's series. */
export function contextRow(
  ordinal: number,
  figures: {
    readonly input?: number;
    readonly read: number;
    readonly created?: number;
    readonly parent?: string;
    readonly model?: string;
  },
): RunTurnRowFixture {
  return {
    ordinal,
    model: figures.model ?? "claude-opus-5-5",
    tokensInput: figures.input ?? 2,
    tokensOutput: 40,
    tokensCacheRead: figures.read,
    tokensCacheCreation: figures.created ?? 100,
    ...(figures.parent === undefined
      ? {}
      : { parentToolUseId: figures.parent }),
    recordedAt: contextRecordedAt,
  };
}

/** A window as the runtime breaks one down, its categories those the design
 * draws. */
export function contextWindow(
  overrides: Partial<RunContextWindow> = {},
): RunContextWindow {
  return {
    model: "claude-opus-5-5",
    totalTokens: 373_880,
    maxTokens: 1_000_000,
    autoCompactThreshold: 967_000,
    categories: [
      { name: "System prompt", tokens: 2_400, kind: "Used" },
      { name: "System tools", tokens: 7_952, kind: "Used" },
      { name: "Memory files", tokens: 6_386, kind: "Used" },
      { name: "Skills", tokens: 7_235, kind: "Used" },
      { name: "Messages", tokens: 349_907, kind: "Used" },
      { name: "Free space", tokens: 593_120, kind: "Free" },
      { name: "Autocompact buffer", tokens: 33_000, kind: "Buffer" },
      { name: "Deferred tools", tokens: 22_455, kind: "Deferred" },
    ],
    memoryFiles: [{ path: "/work/repo/CLAUDE.md", tokens: 2_543 }],
    mcpTools: [],
    systemTools: [],
    systemPromptSections: [],
    agents: [],
    messages: {
      toolCalls: 3,
      toolResults: 40_000,
      attachments: 0,
      assistant: 1_000,
      user: 1_000,
      byTool: [
        { name: "Bash", callTokens: 300, resultTokens: 74_776 },
        { name: "Read", callTokens: 20, resultTokens: 456 },
      ],
    },
    ...overrides,
  };
}

/** A reading taken after the row `afterTurn`. */
export function contextReading(
  ordinal: number,
  afterTurn: number,
  window: RunContextWindow | undefined,
): RunContextReading {
  return {
    ordinal,
    afterTurn,
    cause: "End",
    ...(window === undefined ? {} : { window }),
    recordedAt: contextRecordedAt,
  };
}

/** A compaction's reading after the row `afterTurn`. */
export function contextCompacted(
  ordinal: number,
  afterTurn: number,
  before: number,
  after: number | undefined,
): RunContextReading {
  return {
    ordinal,
    afterTurn,
    cause: "Compaction",
    compaction: {
      trigger: "Auto",
      tokensBefore: before,
      ...(after === undefined ? {} : { tokensAfter: after }),
    },
    recordedAt: contextRecordedAt,
  };
}

/** A run's snapshot with the brief, the window and the files a run has. */
export function contextSnapshot(
  overrides: Partial<RunConfigurationSnapshot> = {},
): RunConfigurationSnapshot {
  return {
    agent: "Claude",
    argv: [
      "claude",
      "--print",
      '--settings={"autoCompactWindow":350000}',
      "# Implement the ticket\n\nYou are developing Chuggy itself.",
    ],
    files: [
      {
        source: "Settings",
        path: "/work/repo/.claude/settings.json",
        bytes: 620,
        content: "{}",
      },
      {
        source: "ProjectInstruction",
        path: "/work/repo/CLAUDE.md",
        bytes: 7_657,
        content: "# chuggy",
      },
    ],
    init: {
      cwd: "/work/repo",
      tools: ["Bash", "Read", "Edit"],
      mcp_servers: [],
      skills: ["review"],
      agents: ["Explore"],
      plugins: [],
    },
    dropped: [],
    ...overrides,
  };
}

/** The transcript lines of one tool call and its result, billed as the call
 * whose figures they name, and made under the subagent call `parent` names. */
export function contextToolLines(
  id: string,
  tool: string,
  command: string,
  result: string,
  billed: {
    readonly input?: number;
    readonly read: number;
    readonly created?: number;
    readonly parent?: string;
  },
): readonly unknown[] {
  return [
    {
      type: "assistant",
      parent_tool_use_id: billed.parent ?? null,
      message: {
        content: [{ type: "tool_use", id, name: tool, input: { command } }],
        usage: {
          input_tokens: billed.input ?? 2,
          cache_read_input_tokens: billed.read,
          cache_creation_input_tokens: billed.created ?? 100,
        },
      },
    },
    {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: id, content: result }],
      },
    },
  ];
}

/** A tool's call and the screenshot it returned: an image, and no text. */
export function contextImageLines(
  id: string,
  read: number,
): readonly unknown[] {
  const [asked] = contextToolLines(id, "Read", "shot.png", "", { read });
  return [
    asked,
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  data: { chuggy_truncated: { bytes: 90_000, digest: "d" } },
                },
              },
            ],
          },
        ],
      },
    },
  ];
}

/** A session's readings, one window at the end of each turn named. */
export function contextSessionBody(
  turns: readonly { readonly ordinal: number; readonly total: number }[],
): SessionContextResponse {
  return {
    turns: turns.map((turn) => ({
      turn: `turn-${String(turn.ordinal)}`,
      ordinal: turn.ordinal,
      readings: [
        {
          cause: "End",
          window: contextWindow({
            totalTokens: turn.total,
            maxTokens: 200_000,
            autoCompactThreshold: 167_000,
            categories: [
              { name: "System prompt", tokens: 2_400, kind: "Used" },
              { name: "Messages", tokens: turn.total - 2_400, kind: "Used" },
              {
                name: "Free space",
                tokens: 200_000 - turn.total - 33_000,
                kind: "Free",
              },
              { name: "Autocompact buffer", tokens: 33_000, kind: "Buffer" },
            ],
          }),
          recordedAt: contextRecordedAt,
        },
      ],
    })),
    systemPrompt: "You are the project's lead.",
    autoCompactWindow: 200_000,
  };
}
