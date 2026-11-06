// A file and a collector at once. A local HTTP server stands in for the collector and prints one line per
// request it receives. COLLECTOR_STATUS=<code> makes it answer that status; COLLECTOR_GZIP=1 asks for gzip.
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";

import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { OtelscopeTracer } from "@wmaurer/otelscope-effect";
import { Array as Arr, ConfigProvider, Console, Effect } from "effect";
import { FetchHttpClient, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import { NetAddress } from "effect/net";

const status = Number(process.env.COLLECTOR_STATUS ?? "200");
const compression = process.env.COLLECTOR_GZIP === "1" ? "gzip" : "none";
const names = ["checkout", "load-cart", "charge"];

const collector = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const raw = Buffer.from(yield* request.arrayBuffer);
    const encoding = request.headers["content-encoding"] ?? "none";
    const body = encoding === "gzip" ? gunzipSync(raw) : raw;
    const found = Arr.filter(names, (name) => body.includes(name));
    yield* Console.log(
        `collector: ${request.method} ${request.url} type=${request.headers["content-type"]} encoding=${encoding} bytes=${raw.length} spans=${Arr.join(found, ",")} answered=${status}`,
    );
    return HttpServerResponse.empty({ status });
});

const checkout = Effect.gen(function* () {
    yield* Effect.void.pipe(Effect.withSpan("load-cart", { attributes: { "cart.note": "n".repeat(2_000) } }));
    yield* Effect.void.pipe(Effect.withSpan("charge"));
}).pipe(Effect.withSpan("checkout"));

const main = Effect.gen(function* () {
    yield* HttpServer.serveEffect(collector);
    const { address } = yield* HttpServer.HttpServer;
    const port = NetAddress.isInetAddress(address) ? address.port : 0;
    yield* checkout.pipe(
        Effect.provide(
            OtelscopeTracer.layer({ serviceName: "verify-collector", file: "out/spans.jsonl", runId: "collector" }),
        ),
        // Fallbacks under the real environment, the way the README suggests for OTEL_TRACES_EXPORTER.
        Effect.provide(
            ConfigProvider.layerAdd(
                ConfigProvider.fromUnknown({
                    OTEL_TRACES_EXPORTER: "otlp",
                    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
                    OTEL_EXPORTER_OTLP_COMPRESSION: compression,
                }),
            ),
        ),
    );
    yield* Console.log("program finished");
});

await main.pipe(
    Effect.scoped,
    Effect.provide([
        NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" }),
        NodeServices.layer,
        FetchHttpClient.layer,
    ]),
    Effect.runPromise,
);
