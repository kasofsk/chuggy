/** Preserve JSON's integer/float distinction and exact integer digits at I/O boundaries. */
export declare function parse_json(text: string): unknown;
export declare function number_token(
  container: object,
  key: string | number,
): string | undefined;
export declare function set_number_token(
  container: object,
  key: string | number,
  token: string,
): void;
export declare function copy_json_metadata<T extends object>(
  source: object,
  destination: T,
): T;
export declare function integer_field(
  container: object,
  key: string | number,
): boolean;
export declare function canonical_json(value: unknown): string;
export declare function stringify_json(value: unknown): string;
export declare function canonical_json_field(
  container: object,
  key: string | number,
): string;
