export declare const PARSERS: Readonly<Record<string, string>>;
export declare const LANGUAGES: Readonly<Record<string, string>>;
export declare class CommentSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly replacement: string;
  readonly directive: boolean;
  readonly documentation: boolean;
  readonly syntax: string;
  constructor(
    start: number,
    end: number,
    text: string,
    replacement?: string,
    directive?: boolean,
    documentation?: boolean,
    syntax?: string,
  );
}
export declare class Removal {
  readonly source: string;
  readonly removed: number;
  readonly preserved: number;
  constructor(source: string, removed: number, preserved: number);
}
export declare function supported(path: string): boolean;
export declare function remove_comments(
  path: string,
  source: string,
  previous?: string,
  directives?: readonly string[],
): Promise<Removal>;
