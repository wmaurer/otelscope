import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { OtlpSerialization, OtlpTracer } from "effect/observability";

// `ReceiverClient` always answers 200 because of the behaviour pinned here. When an Effect upgrade changes
// it, this test fails first, and the receiver's contract has to be checked again.
describe("OtlpExporter contract", () => {
    it("drops every buffered span when the receiver answers a non-2xx status", async () => {
        let calls = 0;
        const rejecting = HttpClient.make((request) =>
            Effect.sync(() => {
                calls++;
                return HttpClientResponse.fromWeb(request, new Response(null, { status: 400 }));
            }),
        );
        const tracer = OtlpTracer.layer({
            url: "http://receiver.invalid/v1/traces",
            resource: { serviceName: "test" },
            exportInterval: "50 millis",
        }).pipe(
            Layer.provide(OtlpSerialization.layerJson),
            Layer.provide(Layer.succeed(HttpClient.HttpClient, rejecting)),
        );

        await Effect.runPromise(
            Effect.gen(function* () {
                yield* Effect.void.pipe(Effect.withSpan("first"));
                yield* Effect.sleep("150 millis");
                yield* Effect.void.pipe(Effect.withSpan("second"));
            }).pipe(Effect.provide(tracer)),
        );

        // One call for the first batch. The exporter then disables itself, so neither "second" nor the final
        // flush reaches the client.
        assert.strictEqual(calls, 1);
    });
});
