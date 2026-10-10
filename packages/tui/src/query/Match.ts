import { Array as Arr, Predicate } from "effect";

import { termKey } from "./Query.ts";

import type { Exit, Run, RunId, SpanId, Trace, TraceId } from "../data/Snapshot.ts";
import type { LogLevel } from "../model/levels.ts";
import type { Needle, Query, Term } from "./Query.ts";
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
    const made: Test =
        needle._tag === "Exact"
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

const attrHas = (attrs: Attributes, key: string, value: Test | undefined): boolean => {
    const found = attrs[key];
    return found !== undefined && (value === undefined || valueHas(found, value));
};

/** The test of a text term's needle or an attribute term's value, looked up once per trace rather than per span. */
const termTest = (term: Term): Test | undefined => {
    switch (term._tag) {
        case "Text":
            return testOf(term.needle);
        case "Attr":
            return term.value._tag === "Some" ? testOf(term.value.value) : undefined;
        case "Exit":
        case "Level":
        case "Never":
            return undefined;
    }
};

const spanHas = (span: JsonlSpanRecord, term: Term, test: Test | undefined): boolean => {
    switch (term._tag) {
        case "Text":
            return test !== undefined && textHas(span, test);
        case "Attr": {
            if (attrHas(span.attrs, term.key, test)) {
                return true;
            }
            for (const event of span.events) {
                if (attrHas(event.attrs, term.key, test)) {
                    return true;
                }
            }
            return false;
        }
        case "Exit":
            return span.exit === term.exit;
        case "Level":
        case "Never":
            return false;
    }
};

export const spanMatches = (query: Query, span: JsonlSpanRecord): boolean => {
    for (const term of query) {
        if (!spanHas(span, term, termTest(term))) {
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
    const test = termTest(term);
    if (trace.runs.length === 1) {
        for (const span of trace.spans.values()) {
            if (spanHas(span, term, test)) {
                return trace.runs;
            }
        }
        return NONE;
    }
    const runs: Array<RunId> = [];
    for (const span of trace.spans.values()) {
        if (!Arr.contains(runs, span.run) && spanHas(span, term, test)) {
            runs[runs.length] = span.run;
        }
    }
    return runs.length === 0 ? NONE : runs;
};

const traceHits = (term: Term, trace: Trace): ReadonlyArray<RunId> => {
    if (term._tag === "Level" || term._tag === "Never") {
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
    if (term._tag === "Level" || term._tag === "Never") {
        return NO_SPANS;
    }
    const { records, traces } = spanCaches.forTerm(term);
    const known = traces.get(trace);
    if (known !== undefined) {
        return known;
    }
    const hits: Array<SpanId> = [];
    const test = termTest(term);
    for (const span of trace.spans.values()) {
        let verdict = records.get(span);
        if (verdict === undefined) {
            spansScanned += 1;
            verdict = spanHas(span, term, test);
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
    if (term._tag === "Text" && has(run.id, term.needle)) {
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
    switch (term._tag) {
        case "Text": {
            const { needle } = term;
            return (
                has(line.message, needle) ||
                has(line.level, needle) ||
                has(line.fiber, needle) ||
                has(line.spanName, needle) ||
                Arr.some(line.annotations, ([key, value]) => has(key, needle) || has(value, needle))
            );
        }
        case "Attr": {
            const value = term.value._tag === "Some" ? term.value.value : undefined;
            return Arr.some(
                line.annotations,
                ([key, found]) => key === term.key && (value === undefined || has(found, value)),
            );
        }
        case "Level":
            return line.level.toLowerCase() === term.level;
        case "Exit":
            return line.exit === term.exit;
        case "Never":
            return false;
    }
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
