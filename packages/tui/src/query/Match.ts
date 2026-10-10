import { Array as Arr, Predicate } from "effect";

import { termKey } from "./Query.ts";

import type { Run, RunId, Trace, TraceId } from "../data/Snapshot.ts";
import type { Needle, Query, Term } from "./Query.ts";
import type { AttributeValue, Attributes, JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

export const has = (haystack: string, needle: Needle): boolean =>
    needle._tag === "Exact"
        ? haystack.includes(needle.text)
        : haystack.includes(needle.lower) || haystack.toLowerCase().includes(needle.lower);

const valueHas = (value: AttributeValue, needle: Needle): boolean => {
    if (Predicate.isString(value)) {
        return has(value, needle);
    }
    if (value === null || Predicate.isNumber(value) || Predicate.isBoolean(value)) {
        return has(String(value), needle);
    }
    for (const item of value) {
        if (valueHas(item, needle)) {
            return true;
        }
    }
    return false;
};

const PREVIEW = ".preview";

const isBodyMeta = (attrs: Attributes, key: string): boolean => {
    const dot = key.lastIndexOf(".");
    if (dot < 0) {
        return false;
    }
    const suffix = key.slice(dot);
    return (suffix === ".sha256" || suffix === ".bytes") && `${key.slice(0, dot)}${PREVIEW}` in attrs;
};

const attrsHave = (attrs: Attributes, needle: Needle): boolean => {
    for (const key in attrs) {
        const value = attrs[key];
        if (value !== undefined && !isBodyMeta(attrs, key) && (has(key, needle) || valueHas(value, needle))) {
            return true;
        }
    }
    return false;
};

const textHas = (span: JsonlSpanRecord, needle: Needle): boolean => {
    if (
        has(span.name, needle) ||
        has(span.span, needle) ||
        has(span.trace, needle) ||
        has(span.service, needle) ||
        (span.site !== null && has(span.site.file, needle)) ||
        (span.def !== null && has(span.def.file, needle)) ||
        (span.fiber !== null && has(`#${span.fiber}`, needle)) ||
        attrsHave(span.attrs, needle)
    ) {
        return true;
    }
    for (const event of span.events) {
        if (has(event.name, needle) || attrsHave(event.attrs, needle)) {
            return true;
        }
    }
    return false;
};

const attrHas = (attrs: Attributes, key: string, value: Needle | undefined): boolean => {
    const found = attrs[key];
    return found !== undefined && (value === undefined || valueHas(found, value));
};

const spanHas = (span: JsonlSpanRecord, term: Term): boolean => {
    switch (term._tag) {
        case "Text":
            return textHas(span, term.needle);
        case "Attr": {
            const value = term.value._tag === "Some" ? term.value.value : undefined;
            if (attrHas(span.attrs, term.key, value)) {
                return true;
            }
            for (const event of span.events) {
                if (attrHas(event.attrs, term.key, value)) {
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
        if (!spanHas(span, term)) {
            return false;
        }
    }
    return true;
};

const NONE: ReadonlyArray<RunId> = [];

const TERM_CACHE_SIZE = 32;

class TermCaches {
    private readonly caches = new Map<string, WeakMap<Trace, ReadonlyArray<RunId>>>();

    get(key: string): WeakMap<Trace, ReadonlyArray<RunId>> {
        const found = this.caches.get(key);
        if (found !== undefined) {
            this.caches.delete(key);
            this.caches.set(key, found);
            return found;
        }
        const created = new WeakMap<Trace, ReadonlyArray<RunId>>();
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

const termCaches = new TermCaches();

let scanned = 0;

export const traceScans = (): number => scanned;

const scan = (term: Term, trace: Trace): ReadonlyArray<RunId> => {
    scanned += 1;
    if (trace.runs.length === 1) {
        for (const span of trace.spans.values()) {
            if (spanHas(span, term)) {
                return trace.runs;
            }
        }
        return NONE;
    }
    const runs: Array<RunId> = [];
    for (const span of trace.spans.values()) {
        if (!Arr.contains(runs, span.run) && spanHas(span, term)) {
            runs[runs.length] = span.run;
        }
    }
    return runs.length === 0 ? NONE : runs;
};

const traceHits = (term: Term, trace: Trace): ReadonlyArray<RunId> => {
    if (term._tag === "Level" || term._tag === "Never") {
        return NONE;
    }
    const cache = termCaches.get(termKey(term));
    const hit = cache.get(trace);
    if (hit !== undefined) {
        return hit;
    }
    const answer = scan(term, trace);
    cache.set(trace, answer);
    return answer;
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
