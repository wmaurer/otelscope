import { Cause, Console, Effect, Layer, Schema } from "effect";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http";

import { TraceData } from "./format/TraceData.ts";

const decodeTraceData = Schema.decodeUnknownEffect(Schema.fromJsonString(TraceData));

// `OtlpSerialization.layerJson` always sends a `Uint8Array` body. Any other body decodes as the empty
// string, which fails as invalid JSON.
const bodyText = (request: HttpClientRequest.HttpClientRequest): string =>
    request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";

// Give this client to `OtlpTracer` only. The tracer then posts each batch here instead of to the network, and
// `ingest` receives it in the same process. The client always answers 200: on any other status the exporter
// drops its buffer, stops exporting for 60 seconds, skips its final flush, and reports this only at DEBUG
// level. So a batch that cannot be decoded, or an `ingest` that fails, is reported on stderr and dropped.
export const layer = (ingest: (data: TraceData) => Effect.Effect<void>): Layer.Layer<HttpClient.HttpClient> =>
    Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
            decodeTraceData(bodyText(request)).pipe(
                Effect.flatMap((data) =>
                    ingest(data).pipe(
                        Effect.catchCause((cause) =>
                            Console.error(`otelscope: dropped a batch of spans: ${Cause.pretty(cause)}`),
                        ),
                    ),
                ),
                Effect.catch((error) =>
                    Console.error(`otelscope: could not decode a batch of spans: ${error.message}`),
                ),
                Effect.as(HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }))),
            ),
        ),
    );
