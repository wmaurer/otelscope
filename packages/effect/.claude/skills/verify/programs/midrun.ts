// Three runs share a file: the first two store one body between them, then the file turns read-only and the
// third run's write fails. Expect one warning, six records and a clean exit.
import { chmodSync } from "node:fs";

import { NodeServices } from "@effect/platform-node";
import { JsonlTrace } from "@wmaurer/otelscope-effect";
import { Effect } from "effect";

const run = (label: string, bodies: boolean) =>
    Effect.forEach(
        [1, 2, 3],
        (i) => Effect.void.pipe(Effect.withSpan(`${label}-${i}`, { attributes: { "x.body": "same text" } })),
        { discard: true },
    ).pipe(
        Effect.provide(
            JsonlTrace.layer({ serviceName: "verify-midrun", file: "out/spans.jsonl", runId: label, bodies }),
        ),
        Effect.provide(NodeServices.layer),
        Effect.runPromise,
    );

await run("first", true);
await run("second", true);
chmodSync("out/spans.jsonl", 0o444);
await run("third", false);
console.log("program finished");
