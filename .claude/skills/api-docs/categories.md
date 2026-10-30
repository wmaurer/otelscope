# Categories

Each exported declaration has one non-empty `@category`. Reuse the categories that the module and its neighbors already use. Prefer lowercase plurals and gerunds, and keep the usual casing of a domain name.

Common categories:

- Shapes: `constructors`, `destructors`, `models`, `schemas`, `guards`, `predicates`, `getters`, `accessors`, `instances`, `constants`, `re-exports`, `unsafe`, `testing`.
- Effect: `services`, `layers`, `context`, `resource management`, `running`, `errors`, `error handling`.
- Operations: `combinators`, `filtering`, `mapping`, `sequencing`, `zipping`, `combining`, `merging`, `converting`, `transforming`, `folding`, `splitting`, `repetition`.
- Shared: `utility types`, `encoding`, `decoding`, `serialization`, `tracing`, `metrics`, `logging`, `annotations`, `symbols`, `configuration`, `comparisons`, `ordering`.

Keep these pairs apart:

- `services` are contracts, and `layers` provide them.
- `getters` return values, and `accessors` read from the context.
- `errors` model failures, and `error handling` recovers from them or maps them.
- `models` are domain data, and `utility types` are type-level contracts.
- `guards` narrow a type, and `predicates` return a boolean.
