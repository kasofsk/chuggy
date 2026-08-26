/**
 * The server-sent-events wire, decoded from bytes into whole frames.
 *
 * A transport hands over chunks that fall wherever the network put them, so
 * this holds a bounded buffer and answers only with frames whose terminator has
 * arrived; all three line endings the format allows are accepted. The buffer is
 * capped because a server that never terminates a frame would otherwise grow
 * one string until the tab dies.
 */

export const streamFrameBytesMax = 262_144;
export const streamFrameEventDefault = "message";

export interface StreamFrame {
  readonly event: string;
  readonly id: string | undefined;
  readonly data: string;
}

export interface StreamDecoder {
  /** The frames this chunk completed, in the order the server sent them. */
  push(chunk: Uint8Array): readonly StreamFrame[];
}

const frameTerminator = /\r\n\r\n|\n\n|\r\r/u;
const lineTerminator = /\r\n|\n|\r/u;

function streamFrameField(line: string): readonly [string, string] | undefined {
  if (line === "" || line.startsWith(":")) return undefined;
  const colon = line.indexOf(":");
  if (colon < 0) return [line, ""];
  const value = line.slice(colon + 1);
  return [line.slice(0, colon), value.startsWith(" ") ? value.slice(1) : value];
}

function streamFrameFromBlock(block: string): StreamFrame | undefined {
  let event = streamFrameEventDefault;
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.split(lineTerminator)) {
    const field = streamFrameField(line);
    if (field === undefined) continue;
    if (field[0] === "event") event = field[1];
    else if (field[0] === "id") id = field[1];
    else if (field[0] === "data") data.push(field[1]);
  }
  if (data.length === 0) return undefined;
  return { event, id, data: data.join("\n") };
}

export function createStreamDecoder(): StreamDecoder {
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    push(chunk: Uint8Array): readonly StreamFrame[] {
      buffer += decoder.decode(chunk, { stream: true });
      const frames: StreamFrame[] = [];
      for (;;) {
        const terminator = frameTerminator.exec(buffer);
        if (terminator === null) break;
        const block = buffer.slice(0, terminator.index);
        buffer = buffer.slice(terminator.index + terminator[0].length);
        const frame = streamFrameFromBlock(block);
        if (frame !== undefined) frames.push(frame);
      }
      if (buffer.length > streamFrameBytesMax)
        throw new RangeError("a stream frame outgrew the buffer it is read in");
      return frames;
    },
  };
}
