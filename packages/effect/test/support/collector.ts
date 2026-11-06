import { gunzipSync } from "node:zlib";

import { assert } from "@effect/vitest";
import { Array as Arr, ConfigProvider, Effect, Layer, Option, Predicate, Record, Ref } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

// A request as the collector receives it.
export interface Received {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
}

// An HttpClient standing in for a collector. It records every request and answers the n-th one (from 0) with
// `status(n)`.
export const recordingCollector = (status: (n: number) => number = () => 200) =>
    Effect.map(Ref.make<ReadonlyArray<Received>>([]), (received) => ({
        received: Ref.get(received),
        layer: Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
                Ref.modify(received, (all) => [
                    HttpClientResponse.fromWeb(request, new Response(null, { status: status(all.length) })),
                    Arr.append(all, {
                        url: request.url,
                        headers: { ...request.headers },
                        body: Predicate.isTagged(request.body, "Uint8Array") ? request.body.body : new Uint8Array(),
                    }),
                ]),
            ),
        ),
    }));

// The parts of a request that the environment decides. `content-length` varies with the random span ids.
export const configured = (request: Received) => ({
    url: request.url,
    headers: Record.remove(request.headers, "content-length"),
});

export const env = (variables: Readonly<Record<string, string>>) =>
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...variables } }));

// A span as the collector decodes it from the request's OTLP protobuf body.
export interface CollectedSpan {
    readonly traceId: string;
    readonly spanId: string;
    readonly name: string;
    readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

interface Field {
    readonly number: number;
    readonly varint: bigint;
    readonly bytes: Uint8Array;
}

const varintAt = (buffer: Uint8Array, start: number): readonly [value: bigint, next: number] => {
    let value = 0n;
    let at = start;
    for (let shift = 0n; ; shift += 7n) {
        const byte = buffer[at++] ?? 0;
        value |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return [value, at];
    }
};

const fieldAt = (buffer: Uint8Array, start: number): readonly [field: Field, next: number] => {
    const [key, at] = varintAt(buffer, start);
    const number = Number(key >> 3n);
    const bytes = (from: number, length: number): readonly [Field, number] => [
        { number, varint: 0n, bytes: buffer.subarray(from, from + length) },
        from + length,
    ];
    switch (Number(key & 7n)) {
        case 0: {
            const [varint, next] = varintAt(buffer, at);
            return [{ number, varint, bytes: new Uint8Array() }, next];
        }
        case 1:
            return bytes(at, 8);
        case 2: {
            const [length, from] = varintAt(buffer, at);
            return bytes(from, Number(length));
        }
        case 5:
            return bytes(at, 4);
        default:
            return assert.fail(`protobuf wire type ${String(key & 7n)} at byte ${start}`);
    }
};

// The protobuf wire format, enough to read `TracesData`: varints, fixed64 and length-delimited fields.
const fieldsOf = (buffer: Uint8Array, at = 0): ReadonlyArray<Field> => {
    if (at >= buffer.length) return [];
    const [field, next] = fieldAt(buffer, at);
    return Arr.prepend(fieldsOf(buffer, next), field);
};

const all = (buffer: Uint8Array, number: number): ReadonlyArray<Uint8Array> =>
    Arr.map(
        Arr.filter(fieldsOf(buffer), (field) => field.number === number),
        (field) => field.bytes,
    );

const one = (buffer: Uint8Array, number: number): Field | undefined =>
    Arr.findFirst(fieldsOf(buffer), (field) => field.number === number).pipe(Option.getOrUndefined);

const utf8 = new TextDecoder();
const hex = (bytes: Uint8Array | undefined): string => Buffer.from(bytes ?? []).toString("hex");

// AnyValue: 1 string, 2 bool, 3 int, 4 double.
const anyValue = (buffer: Uint8Array): string | number | boolean => {
    const [field] = fieldsOf(buffer);
    if (field?.number === 1) return utf8.decode(field.bytes);
    if (field?.number === 2) return field.varint === 1n;
    if (field?.number === 3) return Number(field.varint);
    if (field?.number === 4) return new DataView(field.bytes.buffer, field.bytes.byteOffset).getFloat64(0, true);
    return assert.fail(`unexpected AnyValue field ${String(field?.number)}`);
};

// TracesData 1 resource_spans; ResourceSpans 2 scope_spans; ScopeSpans 2 spans; Span 1 trace_id, 2 span_id,
// 5 name, 9 attributes; KeyValue 1 key, 2 value.
export const spansIn = (request: Received): ReadonlyArray<CollectedSpan> => {
    const body =
        request.headers["content-encoding"] === "gzip" ? new Uint8Array(gunzipSync(request.body)) : request.body;
    return Arr.flatMap(all(body, 1), (resourceSpans) =>
        Arr.flatMap(all(resourceSpans, 2), (scopeSpans) =>
            Arr.map(all(scopeSpans, 2), (span) => ({
                traceId: hex(one(span, 1)?.bytes),
                spanId: hex(one(span, 2)?.bytes),
                name: utf8.decode(one(span, 5)?.bytes),
                attributes: Object.fromEntries(
                    Arr.map(all(span, 9), (keyValue) => [
                        utf8.decode(one(keyValue, 1)?.bytes),
                        anyValue(one(keyValue, 2)?.bytes ?? new Uint8Array()),
                    ]),
                ),
            })),
        ),
    );
};
