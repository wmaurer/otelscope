// `bodies: true`: a small body, the same body again (stored once), and one over the 1,000,000-character cap.
import { NodeServices } from "@effect/platform-node";
import { JsonlTrace } from "@wmaurer/otelscope-effect";
import { Effect } from "effect";

const prompt = "Summarise the order history for customer u-42. ".repeat(10);
const huge = "x".repeat(1_200_000);

const program = Effect.gen(function* () {
    yield* Effect.void.pipe(Effect.withSpan("ask", { attributes: { "llm.request.body": prompt, "llm.model": "m1" } }));
    yield* Effect.void.pipe(Effect.withSpan("ask-again", { attributes: { "llm.request.body": prompt } }));
    yield* Effect.void.pipe(Effect.withSpan("upload", { attributes: { "http.request.body": huge } }));
}).pipe(Effect.withSpan("session"));

await program.pipe(
    Effect.provide(
        JsonlTrace.layer({
            serviceName: "verify-bodies",
            file: "out/spans.jsonl",
            runId: "verify-bodies",
            bodies: true,
        }),
    ),
    Effect.provide(NodeServices.layer),
    Effect.runPromise,
);
