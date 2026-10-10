import { Array as Arr, Option, Order, pipe, Predicate } from "effect";
import { AsyncResult } from "effect/reactivity";

import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

/** A body the writer moved to `bodies/<sha256>.txt`, leaving `<prefix>.sha256`, `.bytes` and `.preview` on the span. */
export interface BodyRef {
    readonly prefix: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly preview: string;
}

const SHA256 = ".sha256";

/** One per `<prefix>.sha256` string attribute, sorted by prefix: the order of the Bodies rows, `b` and the Body screen's Tab. */
export const bodiesOf = (span: JsonlSpanRecord): ReadonlyArray<BodyRef> =>
    pipe(
        Object.entries(span.attrs),
        Arr.map(([key, sha256]) => {
            if (!key.endsWith(SHA256) || !Predicate.isString(sha256)) {
                return Option.none();
            }
            const prefix = key.slice(0, -SHA256.length);
            const bytes = span.attrs[`${prefix}.bytes`];
            const preview = span.attrs[`${prefix}.preview`];
            return Option.some<BodyRef>({
                prefix,
                sha256,
                bytes: Predicate.isNumber(bytes) ? bytes : 0,
                preview: Predicate.isString(preview) ? preview : "",
            });
        }),
        Arr.getSomes,
        Arr.sort(Order.mapInput(Order.String, (ref: BodyRef) => ref.prefix)),
    );

export type BodyState = "ok" | "truncated" | "missing" | "unknown";

/** From the `Bodies.stat` result for the body's sha256, None or still loading when not known yet. */
export const bodyState = (
    ref: BodyRef,
    stat: Option.Option<AsyncResult.AsyncResult<Option.Option<number>>>,
): BodyState =>
    Option.match(Option.flatMap(stat, AsyncResult.value), {
        onNone: () => "unknown",
        onSome: (size) =>
            Option.match(size, {
                onNone: () => "missing",
                onSome: (bytes) => (bytes < ref.bytes ? "truncated" : "ok"),
            }),
    });
