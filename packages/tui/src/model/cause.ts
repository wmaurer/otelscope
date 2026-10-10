import { Array as Arr, Data, Option, Predicate } from "effect";

import { lastSegments } from "./format.ts";
import { chunk } from "./Role.ts";
import { cutLine } from "./text.ts";

import type { SpanId } from "../data/Snapshot.ts";
import type { Line } from "./Role.ts";
import type { TreeFacts } from "./treeFacts.ts";
import type { AttributeValue, JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

export interface Frame {
    /** None for a frame written `at <loc>`. */
    readonly name: Option.Option<string>;
    /** The frame was named `<name> (definition)`: where an `Effect.fn` is defined. */
    readonly definition: boolean;
    readonly file: string;
    readonly line: number;
    readonly col: number;
}

const NAMED = /^at (.*) \((.*):(\d+):(\d+)\)$/;
const BARE = /^at (.*):(\d+):(\d+)$/;
const DEFINITION = " (definition)";
const FILE_URL = "file://";

const frameOf = (name: Option.Option<string>, path: string, line: string, col: string): Option.Option<Frame> => {
    const file = path.startsWith(FILE_URL) ? path.slice(FILE_URL.length) : path;
    if (file.startsWith("node:") || /(^|[\\/])node_modules[\\/]/.test(file)) {
        return Option.none();
    }
    const definition = Option.exists(name, (text) => text.endsWith(DEFINITION));
    return Option.some({
        name: definition ? Option.map(name, (text) => text.slice(0, -DEFINITION.length)) : name,
        definition,
        file,
        line: Number(line),
        col: Number(col),
    });
};

const parseFrame = (text: string): Option.Option<Frame> => {
    const line = text.trim();
    const named = NAMED.exec(line);
    if (named !== null) {
        return frameOf(Option.some(named[1] ?? ""), named[2] ?? "", named[3] ?? "", named[4] ?? "");
    }
    const bare = BARE.exec(line);
    return bare === null ? Option.none() : frameOf(Option.none(), bare[1] ?? "", bare[2] ?? "", bare[3] ?? "");
};

/** The located frames of a stack trace; frames under `node_modules/`, with a `node:` path or no location are dropped. */
export const parseFrames = (stacktrace: string): ReadonlyArray<Frame> =>
    Arr.getSomes(Arr.map(stacktrace.split("\n"), parseFrame));

export interface Thrown {
    readonly type: string;
    readonly message: string;
    /** The head is the throw-site frame. */
    readonly frames: ReadonlyArray<Frame>;
}

const stringAttr = (value: AttributeValue | undefined): string => (Predicate.isString(value) ? value : "");

// oxlint-disable-next-line effect-native/imperative-collection-build -- a cache: filling it is the design.
const thrownCache = new WeakMap<JsonlSpanRecord, ReadonlyArray<Thrown>>();

/** The span's `exception` events in order. */
export const thrownOf = (span: JsonlSpanRecord): ReadonlyArray<Thrown> => {
    const cached = thrownCache.get(span);
    if (cached !== undefined) {
        return cached;
    }
    const thrown = Arr.map(
        Arr.filter(span.events, (event) => event.name === "exception"),
        (event): Thrown => ({
            type: stringAttr(event.attrs["exception.type"]),
            message: stringAttr(event.attrs["exception.message"]),
            frames: parseFrames(stringAttr(event.attrs["exception.stacktrace"])),
        }),
    );
    thrownCache.set(span, thrown);
    return thrown;
};

const sameSite = (a: Option.Option<Frame>, b: Option.Option<Frame>): boolean =>
    Option.match(a, {
        onNone: () => Option.isNone(b),
        onSome: (x) => Option.exists(b, (y) => x.file === y.file && x.line === y.line && x.col === y.col),
    });

/** Same `exception.type` and same throw-site frame. */
export const sameThrown = (a: Thrown, b: Thrown): boolean =>
    a.type === b.type && sameSite(Arr.head(a.frames), Arr.head(b.frames));

/**
 * The first failure origin in the span's subtree, in tree order, whose first exception is the same as the span's
 * first; any first origin when the span has no exception. An origin is its own origin.
 */
export const originOf = (facts: TreeFacts, spanId: SpanId): Option.Option<SpanId> => {
    const span = facts.trace.spans.get(spanId);
    const order = facts.order();
    const position = order.position(spanId);
    if (span === undefined || span.exit !== "Failure" || position < 0) {
        return Option.none();
    }
    const end = order.end(position);
    const first = Arr.head(thrownOf(span));
    const matches = (id: SpanId): boolean =>
        Option.match(first, {
            onNone: () => true,
            onSome: (own) => {
                const other = facts.trace.spans.get(id);
                return other !== undefined && Option.exists(Arr.head(thrownOf(other)), (head) => sameThrown(own, head));
            },
        });
    return Option.flatMap(
        Arr.findFirst(order.origins, (at) => at >= position && at < end && matches(order.ids[at] ?? "")),
        (at) => Option.fromUndefinedOr(order.ids[at]),
    );
};

export type Cause = Data.TaggedEnum<{
    /** A failure origin with exceptions, or a propagated span whose origin cannot be found. */
    Full: { readonly thrown: ReadonlyArray<Thrown> };
    Propagated: { readonly type: string; readonly origin: SpanId };
    /** A failed span without exceptions; `child` is its first failed child. */
    ChildFailed: { readonly child: SpanId };
    /** A failed span without exceptions and without a failed child. */
    Unrecorded: {};
    Interrupted: {};
    None: {};
}>;
export const Cause = Data.taggedEnum<Cause>();

const NO_CHILDREN: ReadonlyArray<SpanId> = [];

const failedCause = (facts: TreeFacts, span: JsonlSpanRecord): Cause => {
    const thrown = thrownOf(span);
    return Option.match(Arr.head(thrown), {
        onNone: () =>
            Option.match(
                Arr.findFirst(
                    facts.trace.children.get(span.span) ?? NO_CHILDREN,
                    (child) => facts.trace.spans.get(child)?.exit === "Failure",
                ),
                { onNone: () => Cause.Unrecorded(), onSome: (child) => Cause.ChildFailed({ child }) },
            ),
        onSome: (first) =>
            facts.kind(span.span) === "propagated"
                ? Option.match(
                      Option.filter(originOf(facts, span.span), (origin) => origin !== span.span),
                      {
                          onNone: () => Cause.Full({ thrown }),
                          onSome: (origin) => Cause.Propagated({ type: first.type, origin }),
                      },
                  )
                : Cause.Full({ thrown }),
    });
};

export const causeOf = (facts: TreeFacts, spanId: SpanId): Cause => {
    const span = facts.trace.spans.get(spanId);
    if (span === undefined || span.exit === "Success") {
        return Cause.None();
    }
    return span.exit === "Interrupted" ? Cause.Interrupted() : failedCause(facts, span);
};

const where = (frame: Frame): string => `${lastSegments(frame.file)}:${frame.line}:${frame.col}`;

const frameLine = (frame: Frame, index: number, names: ReadonlySet<string>): Line => {
    if (index === 0) {
        return [chunk("thrown at ", "muted"), chunk(where(frame), "text")];
    }
    if (frame.definition) {
        return [chunk("  defined at ", "muted"), chunk(where(frame), "text")];
    }
    return Option.match(frame.name, {
        onNone: () => [chunk("at ", "muted"), chunk(where(frame), "text")],
        onSome: (name) => [
            chunk(names.has(name) ? "in span " : "in ", "muted"),
            chunk(name, "text"),
            chunk(`  ${where(frame)}`, "muted"),
        ],
    });
};

const thrownLines = (thrown: Thrown, names: ReadonlySet<string>): ReadonlyArray<Line> => [
    [chunk(thrown.type, "failure", true)],
    ...(thrown.message === ""
        ? [[chunk("(no message)", "muted")]]
        : Arr.map(thrown.message.split("\n"), (text) => [chunk(text, "text")])),
    ...Arr.map(thrown.frames, (frame, index) => frameLine(frame, index, names)),
];

const nameOf = (facts: TreeFacts, spanId: SpanId): string => facts.trace.spans.get(spanId)?.name ?? spanId;

const heading = (text: string): Line => [chunk(text, "text", true)];

/** The Cause (or Interrupted) section, heading included; empty for a span that succeeded. */
export const causeLines = (cause: Cause, facts: TreeFacts, width: number): ReadonlyArray<Line> => {
    const lines: ReadonlyArray<Line> = Cause.$match(cause, {
        Full: ({ thrown }) => [
            heading("Cause"),
            ...Arr.flatMap(thrown, (one, i) => [...(i === 0 ? [] : [[]]), ...thrownLines(one, facts.spanNames())]),
        ],
        Propagated: ({ type, origin }) => [
            heading("Cause"),
            [
                chunk("↳ ", "muted"),
                chunk(type, "failure"),
                chunk(", from ", "muted"),
                chunk(nameOf(facts, origin), "text"),
            ],
        ],
        ChildFailed: ({ child }) => [
            heading("Cause"),
            [chunk("failed because ", "muted"), chunk(nameOf(facts, child), "text"), chunk(" failed", "muted")],
        ],
        Unrecorded: () => [heading("Cause"), [chunk("failed (no exception recorded)", "muted")]],
        Interrupted: () => [
            heading("Interrupted"),
            [chunk("The span's fiber was interrupted before it finished.", "interrupted")],
        ],
        None: () => [],
    });
    return Arr.map(lines, (line) => cutLine(line, width));
};
