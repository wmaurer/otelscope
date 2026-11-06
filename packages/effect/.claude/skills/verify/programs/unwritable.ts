// The JSONL file sits under a regular file, so it can never be created. The program must still succeed.
import { writeFileSync } from "node:fs";

import { NodeServices } from "@effect/platform-node";
import { OtelscopeTracer } from "@wmaurer/otelscope-effect";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";

writeFileSync("blocker", "not a directory\n");

const program = Effect.forEach([1, 2, 3], (i) => Effect.logInfo(`step ${i}`).pipe(Effect.withSpan(`step-${i}`)), {
    discard: true,
}).pipe(Effect.withSpan("job"));

await program.pipe(
    Effect.provide(OtelscopeTracer.layer({ serviceName: "verify-unwritable", file: "blocker/out/spans.jsonl" })),
    Effect.provide([NodeServices.layer, FetchHttpClient.layer]),
    Effect.runPromise,
);
console.log("program finished");
