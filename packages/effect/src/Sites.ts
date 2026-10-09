import { Tracer } from "effect";

import type { Location } from "./format/Jsonl.ts";

// The attributes `withSites` sets on a span, which `toRecord` lifts into the record's `site`, `def` and `fiber`.
export const SITE = ["code.file.path", "code.line.number", "code.column.number"] as const;
export const DEF = ["otelscope.def.file.path", "otelscope.def.line.number", "otelscope.def.column.number"] as const;
export const FIBER = "otelscope.fiber.id";

export type LocationKeys = typeof SITE | typeof DEF;

// `at <anonymous> (/abs/path.ts:32:40)` under tsx and CommonJS, `at file:///abs/path.mjs:32:40` under Node ESM.
const FRAME = /^\s*at (?:.*? \()?(?:file:\/\/)?(\/[^)]+?):(\d+):(\d+)\)?\s*$/m;

export const parseFrame = (stack: string | undefined): Location | undefined => {
    const match = stack === undefined ? null : FRAME.exec(stack);
    return match === null
        ? undefined
        : { file: decodeURI(match[1] ?? ""), line: Number(match[2]), col: Number(match[3]) };
};

const annotate = (span: Tracer.Span, keys: LocationKeys, location: Location | undefined): void => {
    if (location === undefined) return;
    span.attribute(keys[0], location.file);
    span.attribute(keys[1], location.line);
    span.attribute(keys[2], location.col);
};

// Effect calls `context` for every primitive a fiber evaluates. The first primitive evaluated with a span as
// `fiber.cache.span` runs on the fiber that opened it, and carries the span's call site as the fiber's stack
// frame; for an `Effect.fn` span, the frame's parent is the function's definition.
export const withSites = (inner: Tracer.Tracer): Tracer.Tracer => {
    const located = new WeakSet<Tracer.Span>();
    const fibered = new WeakSet<Tracer.Span>();
    return Tracer.make({
        span: (options) => inner.span(options),
        context: (primitive, fiber) => {
            const span = fiber.cache.span;
            if (span?._tag === "Span") {
                if (!fibered.has(span)) {
                    fibered.add(span);
                    span.attribute(FIBER, fiber.id);
                }
                const frame = fiber.cache.stackFrame;
                if (frame?.name === span.name && !located.has(span)) {
                    located.add(span);
                    try {
                        annotate(span, SITE, parseFrame(frame.stack()));
                        if (frame.parent?.name === `${span.name} (definition)`) {
                            annotate(span, DEF, parseFrame(frame.parent.stack()));
                        }
                    } catch {
                        // A span without a location is fine; failing the program is not.
                    }
                }
            }
            return primitive["~effect/Effect/evaluate"](fiber);
        },
    });
};
