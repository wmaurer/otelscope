import { Array as Arr, Data, Option, Predicate } from "effect";

import { Term, termKey } from "./Query.ts";

import type { Exit, Run, RunId, SpanId, Trace, TraceId } from "../data/Snapshot.ts";
import type { LogLevel } from "../model/levels.ts";
import type { Needle, Query } from "./Query.ts";
import type { AttributeValue, Attributes, JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

/** Whether a string contains a needle. */
type Test = (haystack: string) => boolean;

const SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** A lowercase needle as a regular expression that folds case: the `iu` flags fold by Unicode's simple case folding. */
export const foldedPattern = (lower: string, flags: "iu" | "giu"): RegExp =>
    new RegExp(lower.replace(SPECIAL, "\\$&"), flags);

// oxlint-disable-next-line effect-native/imperative-collection-build -- a cache: filling it is the design.
const tests = new WeakMap<Needle, Test>();

/**
 * A folded needle is one case-insensitive regular expression. A search tests millions of strings, and lowering each
 * would copy every string that has a capital: on `huge`'s 3.6 million strings, 84 ms against 49 ms for the regular
 * expression.
 */
const testOf = (needle: Needle): Test => {
    const known = tests.get(needle);
    if (known !== undefined) {
        return known;
    }
    const made: Test = Predicate.isTagged(needle, "Exact")
        ? (haystack) => haystack.includes(needle.text)
        : (
              (pattern: RegExp) => (haystack: string) =>
                  pattern.test(haystack)
          )(foldedPattern(needle.lower, "iu"));
    tests.set(needle, made);
    return made;
};

export const has = (haystack: string, needle: Needle): boolean => testOf(needle)(haystack);

const valueHas = (value: AttributeValue, test: Test): boolean => {
    if (Predicate.isString(value)) {
        return test(value);
    }
    if (value === null || Predicate.isNumber(value) || Predicate.isBoolean(value)) {
        return test(String(value));
    }
    for (const item of value) {
        if (valueHas(item, test)) {
            return true;
        }
    }
    return false;
};

const PREVIEW = ".preview";

const isBodyMeta = (attrs: Attributes, key: string): boolean => {
    const suffix = key.endsWith(".sha256") ? ".sha256" : key.endsWith(".bytes") ? ".bytes" : undefined;
    return suffix !== undefined && `${key.slice(0, -suffix.length)}${PREVIEW}` in attrs;
};

const attrsHave = (attrs: Attributes, test: Test): boolean => {
    for (const key in attrs) {
        const value = attrs[key];
        if (value !== undefined && !isBodyMeta(attrs, key) && (test(key) || valueHas(value, test))) {
            return true;
        }
    }
    return false;
};

const textHas = (span: JsonlSpanRecord, test: Test): boolean => {
    if (
        test(span.name) ||
        test(span.span) ||
        test(span.trace) ||
        test(span.service) ||
        (span.site !== null && test(span.site.file)) ||
        (span.def !== null && test(span.def.file)) ||
        (span.fiber !== null && test(`#${span.fiber}`)) ||
        attrsHave(span.attrs, test)
    ) {
        return true;
    }
    for (const event of span.events) {
        if (test(event.name) || attrsHave(event.attrs, test)) {
            return true;
        }
    }
    return false;
};

/** The key is typed by the user, and `constructor` must not find `Object.prototype`'s. */
const attrHas = (attrs: Attributes, key: string, value: Test | undefined): boolean => {
    const found = Object.hasOwn(attrs, key) ? attrs[key] : undefined;
    return found !== undefined && (value === undefined || valueHas(found, value));
};

type SpanTest = (span: JsonlSpanRecord) => boolean;

const noSpan: SpanTest = () => false;

const attrIn =
    (key: string, value: Test | undefined): SpanTest =>
    (span) => {
        if (attrHas(span.attrs, key, value)) {
            return true;
        }
        for (const event of span.events) {
            if (attrHas(event.attrs, key, value)) {
                return true;
            }
        }
        return false;
    };

const spanTestOf: (term: Term) => SpanTest = Term.$match({
    Text: ({ needle }): SpanTest => {
        const test = testOf(needle);
        return (span) => textHas(span, test);
    },
    Attr: ({ key, value }) => attrIn(key, Option.isSome(value) ? testOf(value.value) : undefined),
    Exit:
        ({ exit }): SpanTest =>
        (span) =>
            span.exit === exit,
    Level: () => noSpan,
    Never: () => noSpan,
});

const spanTests = new WeakMap<Term, SpanTest>();

/** A term's test of one span, made once per term so the scan loops do not branch on the term for every span. */
const spanTest = (term: Term): SpanTest => {
    const known = spanTests.get(term);
    if (known !== undefined) {
        return known;
    }
    const made = spanTestOf(term);
    spanTests.set(term, made);
    return made;
};

const isText = Term.$is("Text");
const isAttr = Term.$is("Attr");
const isExit = Term.$is("Exit");
const isLevel = Term.$is("Level");

export const spanMatches = (query: Query, span: JsonlSpanRecord): boolean => {
    for (const term of query) {
        if (!spanTest(term)(span)) {
            return false;
        }
    }
    return true;
};

const NONE: ReadonlyArray<RunId> = [];

const TERM_CACHE_SIZE = 32;

/** One cache per term, for the most recently used terms. A term's caches are found by its key, so equal terms share. */
class TermCaches<V> {
    private readonly caches = new Map<string, V>();
    private readonly byTerm = new WeakMap<Term, V>();
    private readonly make: () => V;

    constructor(make: () => V) {
        this.make = make;
    }

    forTerm(term: Term): V {
        const known = this.byTerm.get(term);
        if (known !== undefined) {
            return known;
        }
        const cache = this.get(termKey(term));
        this.byTerm.set(term, cache);
        return cache;
    }

    private get(key: string): V {
        const found = this.caches.get(key);
        if (found !== undefined) {
            this.caches.delete(key);
            this.caches.set(key, found);
            return found;
        }
        const created = this.make();
        this.caches.set(key, created);
        if (this.caches.size > TERM_CACHE_SIZE) {
            const oldest = this.caches.keys().next();
            if (oldest.done !== true) {
                this.caches.delete(oldest.value);
            }
        }
        return created;
    }
}

const traceCaches = new TermCaches(() => new WeakMap<Trace, ReadonlyArray<RunId>>());

let scanned = 0;

export const traceScans = (): number => scanned;

const scan = (term: Term, trace: Trace): ReadonlyArray<RunId> => {
    scanned += 1;
    const matches = spanTest(term);
    if (trace.runs.length === 1) {
        for (const span of trace.spans.values()) {
            if (matches(span)) {
                return trace.runs;
            }
        }
        return NONE;
    }
    const runs: Array<RunId> = [];
    for (const span of trace.spans.values()) {
        if (!Arr.contains(runs, span.run) && matches(span)) {
            runs[runs.length] = span.run;
        }
    }
    return runs.length === 0 ? NONE : runs;
};

const traceHits = (term: Term, trace: Trace): ReadonlyArray<RunId> => {
    if (Predicate.isTagged(term, "Level") || Predicate.isTagged(term, "Never")) {
        return NONE;
    }
    const cache = traceCaches.forTerm(term);
    const hit = cache.get(trace);
    if (hit !== undefined) {
        return hit;
    }
    const answer = scan(term, trace);
    cache.set(trace, answer);
    return answer;
};

interface SpanVerdicts {
    /** Per record: records never change, so a verdict holds for every later `Trace` that keeps the record. */
    readonly records: WeakMap<JsonlSpanRecord, boolean>;
    readonly traces: WeakMap<Trace, ReadonlySet<SpanId>>;
}

const spanCaches = new TermCaches((): SpanVerdicts => ({ records: new WeakMap(), traces: new WeakMap() }));

const NO_SPANS: ReadonlySet<SpanId> = new Set();

let spansScanned = 0;

/** How many records `spanHits` has matched a term against so far. */
export const spanScans = (): number => spansScanned;

/**
 * The spans of the trace that have the term. A trace that grew is matched only on the records it did not have
 * before.
 */
export const spanHits = (term: Term, trace: Trace): ReadonlySet<SpanId> => {
    if (Predicate.isTagged(term, "Level") || Predicate.isTagged(term, "Never")) {
        return NO_SPANS;
    }
    const { records, traces } = spanCaches.forTerm(term);
    const known = traces.get(trace);
    if (known !== undefined) {
        return known;
    }
    const hits: Array<SpanId> = [];
    const matches = spanTest(term);
    for (const span of trace.spans.values()) {
        let verdict = records.get(span);
        if (verdict === undefined) {
            spansScanned += 1;
            verdict = matches(span);
            records.set(span, verdict);
        }
        if (verdict) {
            hits[hits.length] = span.span;
        }
    }
    const found = new Set(hits);
    traces.set(trace, found);
    return found;
};

export const traceMatches = (query: Query, trace: Trace): boolean => {
    for (const term of query) {
        if (traceHits(term, trace).length === 0) {
            return false;
        }
    }
    return true;
};

const runHas = (term: Term, run: Run, traces: ReadonlyMap<TraceId, Trace>): boolean => {
    if (Predicate.isTagged(term, "Text") && has(run.id, term.needle)) {
        return true;
    }
    for (const id of run.traceIds) {
        const trace = traces.get(id);
        if (trace !== undefined && Arr.contains(traceHits(term, trace), run.id)) {
            return true;
        }
    }
    return false;
};

export const runMatches = (query: Query, run: Run, traces: ReadonlyMap<TraceId, Trace>): boolean => {
    for (const term of query) {
        if (!runHas(term, run, traces)) {
            return false;
        }
    }
    return true;
};

/** What a log line is matched on: 08's log-line level. */
export interface LogLine {
    readonly message: string;
    readonly level: LogLevel;
    /** `#7`, or "" when the log carries no fiber. */
    readonly fiber: string;
    readonly spanName: string;
    readonly annotations: ReadonlyArray<readonly [key: string, value: string]>;
    /** The exit of the log's span, for `is:failed` and the like. */
    readonly exit: Exit;
}

const logHas = (line: LogLine, term: Term): boolean => {
    if (isText(term)) {
        const { needle } = term;
        return (
            has(line.message, needle) ||
            has(line.level, needle) ||
            has(line.fiber, needle) ||
            has(line.spanName, needle) ||
            Arr.some(line.annotations, ([key, value]) => has(key, needle) || has(value, needle))
        );
    }
    if (isAttr(term)) {
        const value = Predicate.isTagged(term.value, "Some") ? term.value.value : undefined;
        return Arr.some(
            line.annotations,
            ([key, found]) => key === term.key && (value === undefined || has(found, value)),
        );
    }
    if (isLevel(term)) {
        return line.level.toLowerCase() === term.level;
    }
    if (isExit(term)) {
        return line.exit === term.exit;
    }
    term satisfies Data.TaggedEnum.Value<Term, "Never">;
    return false;
};

/** Every term must match the log line: 08's log-line level. */
export const logMatches = (query: Query, line: LogLine): boolean => {
    for (const term of query) {
        if (!logHas(line, term)) {
            return false;
        }
    }
    return true;
};
