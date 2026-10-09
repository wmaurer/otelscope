// Two runs appended to one file: nested spans, attributes, logs as events, and all three exit kinds.
//
// DEFAULT_RUN_ID=1 omits `runId`, so both runs get the default. CAPTURE_SEED=<absolute path> copies an existing
// JSONL file to out/spans.jsonl first, so the runs append to a file left by an earlier process.
import { copyFileSync, mkdirSync } from "node:fs";

import { NodeServices } from "@effect/platform-node";
import { JsonlTrace } from "@wmaurer/otelscope-effect";
import { Effect, Fiber } from "effect";

const checkout = Effect.gen(function* () {
    yield* Effect.logInfo("loading cart");
    yield* Effect.sleep("20 millis").pipe(Effect.withSpan("load-cart", { attributes: { "cart.items": 3 } }));
    yield* Effect.fail("card declined").pipe(
        Effect.withSpan("charge", { attributes: { "payment.provider": "acme" } }),
        Effect.catch(() => Effect.logWarning("charge failed")),
    );
    const slow = yield* Effect.forkChild(Effect.never.pipe(Effect.withSpan("abandoned")));
    yield* Effect.sleep("5 millis");
    yield* Fiber.interrupt(slow);
}).pipe(Effect.withSpan("checkout", { attributes: { "user.id": "u-42" } }));

const run = (runId: string | undefined) =>
    checkout.pipe(
        Effect.provide(JsonlTrace.layer({ serviceName: "verify-capture", file: "out/spans.jsonl", runId })),
        Effect.provide(NodeServices.layer),
        Effect.runPromise,
    );

const seed = process.env.CAPTURE_SEED;
if (seed !== undefined) {
    mkdirSync("out", { recursive: true });
    copyFileSync(seed, "out/spans.jsonl");
}

const defaultRunId = process.env.DEFAULT_RUN_ID === "1";
await run(defaultRunId ? undefined : "verify-a");
await run(defaultRunId ? undefined : "verify-b");
