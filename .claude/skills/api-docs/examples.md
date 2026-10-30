# Examples

An example is optional. Keep or add one only for behavior that the signature does not show, for a useful composition, or for inference or narrowing that a reader needs to see. Replace or remove an example that is trivial, misleading, contrived, or mostly setup.

Write `**Example** (Title of the use case)`, optional prose, and exactly one non-empty `ts` fence. Each title in a comment is unique, ignoring case.

- Import from the package's public entry points, as a consumer does.
- Arrange a longer example as setup, then the operation, then what to observe. Show the observed value in a comment.
- Run an effect with `await Effect.runPromise(...)`. Use `Effect.runSync` only when synchronous execution is the documented contract.
- Use `Ref`, `Deferred`, or `Queue` to show concurrency, interruption, or races, not a mutable variable.

Nothing runs the examples, so check each new or changed one. Copy it into a temporary file in the package's `src/`, run `pnpm typecheck`, and delete the file.

If writing an example shows a bug in the implementation or the types, report it. A documentation change leaves runtime code as it is.
