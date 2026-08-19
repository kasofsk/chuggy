# Quint model API generation

**Status: PROPOSED** — implementation for issue #98.

`model/api.qnt` is the explicit public data boundary of the Quint model.
`scripts/generate-model-api.ts` compiles it with the pinned Quint CLI and
generates two artifacts. `src/domain/generated/modelTypes.ts` holds the
TypeScript types and the constructor-tag rosters and imports nothing at all;
`src/generated/model-api.ts` holds the Zod value schemas and the JSON codecs,
which need a runtime dependency. The split is what `domain-is-pure` requires:
the domain may read its own vocabulary without any module outside itself, and
that rule admits no carve-out. Neither artifact is hand-written and `--check`
reads both. Generated code does not supply deciders, actions, invariants,
graph algorithms or infrastructure.

## Supported subset

The generator accepts only closed Quint declarations composed of `bool`, `int`,
`str`, records, tuples, closed sums, lists, sets, maps and references to other
explicitly exported API declarations. A public alias begins with `Api`; its
generated TypeScript name drops that prefix. Open rows, recursive types,
unresolved references and every other Quint type construct are errors. A
generation error is preferable to an approximate API.

The model's arbitrary integers map to JavaScript safe integers. A value outside
that range is refused at the generated schema/codec boundary; a future need for
larger values requires an explicit decimal-string or bigint mapping here first.

## JSON mapping

The ordinary generated Zod schema validates the in-memory TypeScript shape.
The generated decoder accepts a JSON form, and the encoder emits that same
form:

| Quint | TypeScript | JSON |
|---|---|---|
| `int` | `number` safe integer | number |
| `List[T]` | `readonly T[]` | array |
| `Set[T]` | `ReadonlySet<T>` | array; decoder rejects duplicate elements |
| `K -> V` | `ReadonlyMap<K, V>` | array of `[key, value]` pairs |
| tuple | readonly fixed tuple | fixed-length array |
| closed sum | string for a nullary constructor, `{ type, value }` otherwise | the same tagged form |
| record | readonly object | object |

These codecs are model-boundary codecs, not the production journal wire format.
The durable journal continues to use its separately versioned canonical encoder
and test vectors. Production adapters may add deliberate branded-ID mappings
outside generated declarations.

## Change protocol

1. Change the model and expose an intentional `Api*` declaration.
2. Run `node scripts/generate-model-api.ts` and review the generated diff.
3. Run the API drift gate and its round-trip/exhaustiveness tests.
4. Update handwritten adapters only where production representation deliberately
   differs; do not copy generated vocabularies into another mirror.

Upgrading Quint is a source/API change: regenerate and review the complete
output under the new pinned compiler before changing the pinned version.
