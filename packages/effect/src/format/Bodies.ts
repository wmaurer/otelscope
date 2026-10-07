import { Array as Arr, Crypto, Effect } from "effect";
import { Hex } from "effect/encoding";

import type { KeyValue, Span } from "./TraceData.ts";

// A prompt or a payload can be hundreds of thousands of characters long. No trace UI can show an attribute of
// that size, so a span attribute whose key ends in `.body` is moved to a file and replaced by a reference.
export const BODY_SUFFIX = ".body";

export const PREVIEW_CHARS = 200;

// The cap is not a working limit: a run can write tens of MB of bodies, and that is intended. It bounds only
// one body that grew far past the expected size.
export const MAX_BODY_CHARS = 1_000_000;

export interface Body {
    readonly sha256: string;
    readonly text: string;
}

export interface SlimSpan {
    readonly span: Span;
    readonly bodies: ReadonlyArray<Body>;
}

const utf8 = new TextEncoder();

export const capBody = (content: string, maxChars: number): string => {
    const overflow = content.length - maxChars;
    return overflow > 0 ? `${content.slice(0, maxChars)}\ntruncated ${overflow} chars` : content;
};

// `sha256` addresses the stored text, which is truncated past `maxChars`. `bytes` measures the full text, so
// the two describe different strings for a body over the cap.
const extract = Effect.fn(function* (prefix: string, content: string, maxChars: number) {
    const crypto = yield* Crypto.Crypto;
    const text = capBody(content, maxChars);
    const sha256 = Hex.encode(yield* crypto.digest("SHA-256", utf8.encode(text)));
    const attributes: ReadonlyArray<KeyValue> = [
        { key: `${prefix}.sha256`, value: { stringValue: sha256 } },
        { key: `${prefix}.bytes`, value: { intValue: utf8.encode(content).length } },
        { key: `${prefix}.preview`, value: { stringValue: content.slice(0, PREVIEW_CHARS) } },
    ];
    return { attributes, bodies: [{ sha256, text }] };
});

// Runs once per span inside the exporter, where the tracer is disabled, so a named span would never be
// recorded.
export const slimSpan = Effect.fn(function* (span: Span, maxChars: number = MAX_BODY_CHARS) {
    const parts = yield* Effect.forEach(span.attributes, (attribute) =>
        attribute.key.endsWith(BODY_SUFFIX) && attribute.value.stringValue !== undefined
            ? extract(attribute.key.slice(0, -BODY_SUFFIX.length), attribute.value.stringValue, maxChars)
            : Effect.succeed({ attributes: [attribute], bodies: [] }),
    );
    return {
        span: { ...span, attributes: Arr.flatMap(parts, (part) => part.attributes) },
        bodies: Arr.flatMap(parts, (part) => part.bodies),
    } satisfies SlimSpan;
});
