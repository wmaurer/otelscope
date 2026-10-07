import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Ref } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { TestConsole } from "effect/testing";

import * as ReceiverClient from "../src/ReceiverClient.ts";
import { otlpSpan, traceData } from "./support/spans.ts";

import type { TraceData } from "../src/format/TraceData.ts";

const post = (request: HttpClientRequest.HttpClientRequest, ingest: (data: TraceData) => Effect.Effect<void>) =>
    Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return yield* client.execute(request);
    }).pipe(Effect.provide(ReceiverClient.layer(ingest)));

const request = HttpClientRequest.post("http://otelscope.invalid/v1/traces");

describe("ReceiverClient", () => {
    it.effect("passes a decoded OTLP/JSON body to ingest and answers 200", () =>
        Effect.gen(function* () {
            const received = yield* Ref.make<ReadonlyArray<TraceData>>([]);
            const data = traceData([otlpSpan({ name: "a", spanId: "s1" })]);

            const response = yield* post(request.pipe(HttpClientRequest.bodyJsonUnsafe(data)), (d) =>
                Ref.update(received, Arr.append(d)),
            );

            assert.strictEqual(response.status, 200);
            assert.deepStrictEqual(yield* Ref.get(received), [data]);
        }),
    );

    it.effect("answers 200 to a body it cannot decode, calls no ingest, and warns once", () =>
        Effect.gen(function* () {
            const calls = yield* Ref.make(0);

            const response = yield* post(request.pipe(HttpClientRequest.bodyText("not json")), () =>
                Ref.update(calls, (n) => n + 1),
            );

            assert.strictEqual(response.status, 200);
            assert.strictEqual(yield* Ref.get(calls), 0);
            assert.lengthOf(yield* TestConsole.errorLines, 1);
        }),
    );

    it.effect("answers 200 when ingest dies, and warns once", () =>
        Effect.gen(function* () {
            const response = yield* post(
                request.pipe(HttpClientRequest.bodyJsonUnsafe(traceData([otlpSpan({ name: "a", spanId: "s1" })]))),
                () => Effect.die("boom"),
            );

            assert.strictEqual(response.status, 200);
            assert.lengthOf(yield* TestConsole.errorLines, 1);
        }),
    );
});
