import { DateTime, Effect, FileSystem, Layer, Path, Random } from "effect";
import { OtlpSerialization, OtlpTracer } from "effect/observability";

import * as JsonlSink from "./JsonlSink.ts";
import * as ReceiverClient from "./ReceiverClient.ts";
import { spansOf } from "./TraceData.ts";

export interface JsonlTraceOptions {
    readonly serviceName: string;
    // The JSONL file. Each batch is appended, so several runs can share one file and stay apart by `run`.
    readonly file: string;
    // The `run` value of every record. `makeRunId` gives the default.
    readonly runId?: string | undefined;
}

// The tracer posts here, but the request never reaches the network: `ReceiverClient` answers it in process.
const RECEIVER_URL = "http://otelscope.invalid/v1/traces";

// `2026-10-06T14-03-27-412-9f3a`: sortable, free of colons, and distinct for two runs in one millisecond.
export const makeRunId: Effect.Effect<string> = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const suffix = yield* Random.nextIntBetween(0, 0xffff);
    const stamp = DateTime.formatIso(now).replace(/[:.]/g, "-").replace(/Z$/, "");
    return `${stamp}-${suffix.toString(16).padStart(4, "0")}`;
});

// Installs Effect's OTLP tracer and writes every span it exports to `file`. Provide it as the outermost layer,
// so the tracer is installed before any other layer is built.
export const layer = (options: JsonlTraceOptions): Layer.Layer<never, never, FileSystem.FileSystem | Path.Path> =>
    Layer.unwrap(
        Effect.gen(function* () {
            const runId = options.runId ?? (yield* makeRunId);
            const write = yield* JsonlSink.make({ file: options.file, runId });

            return OtlpTracer.layer({
                url: RECEIVER_URL,
                resource: { serviceName: options.serviceName },
                // The receiver is local, so this bounds only how long the final flush may take to write.
                // When the exporter reaches it, the exporter drops every span still buffered.
                shutdownTimeout: "30 seconds",
            }).pipe(
                Layer.provide(OtlpSerialization.layerJson),
                Layer.provide(ReceiverClient.layer((data) => write(spansOf(data)))),
            );
        }),
    );
