export type CodecField =
  | readonly [string, string]
  | readonly [string, string, "optional" | "default-empty"];
export declare const codec_schema: Readonly<
  Record<
    string,
    {
      fields?: readonly CodecField[];
      alias?: string;
    }
  >
>;
