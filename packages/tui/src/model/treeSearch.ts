import { Array as Arr, Option, Order } from "effect";

import { spanHits, traceMatches } from "../query/Match.ts";
import { parse } from "../query/Query.ts";
import { count } from "./format.ts";
import { countIn, indexIn } from "./stops.ts";

import type { SpanId } from "../data/Snapshot.ts";
import type { Query } from "../query/Query.ts";
import type { TreeEntry } from "./tree.ts";
import type { Group, TreeFacts } from "./treeFacts.ts";

/** The tree search over one trace: which spans match every term, and where they sit in tree order. */
export interface SpanSearch {
    readonly text: string;
    readonly query: Query;
    /** The query has terms. */
    readonly active: boolean;
    readonly matches: (spanId: SpanId) => boolean;
    /** Sorted tree-order positions of the matching spans. */
    readonly positions: ReadonlyArray<number>;
    /** Matches among the span's strict descendants. */
    readonly below: (spanId: SpanId) => number;
    /** Matches a group hides: those in its members' subtrees, less the shown members' subtrees. */
    readonly hiddenIn: (group: Group, shown: ReadonlyArray<SpanId>) => number;
    /** No single span matches, but every term matches some span of the trace. */
    readonly acrossSpans: boolean;
}

const inactive = (text: string, query: Query): SpanSearch => ({
    text,
    query,
    active: false,
    matches: () => false,
    positions: [],
    below: () => 0,
    hiddenIn: () => 0,
    acrossSpans: false,
});

const NONE: ReadonlySet<SpanId> = new Set();

const allTerms = (facts: TreeFacts, query: Query): ReadonlySet<SpanId> => {
    const sets = Arr.map(query, (term) => spanHits(term, facts.trace));
    const smallest = Arr.reduce(sets, Arr.head(sets), (best, set) =>
        Option.exists(best, (b) => b.size <= set.size) ? best : Option.some(set),
    );
    return Option.match(smallest, {
        onNone: () => NONE,
        onSome: (base) =>
            sets.length === 1
                ? base
                : new Set(Arr.filter(Array.from(base), (id) => Arr.every(sets, (set) => set.has(id)))),
    });
};

const build = (facts: TreeFacts, text: string): SpanSearch => {
    const query = parse(text);
    if (query.length === 0) {
        return inactive(text, query);
    }
    const matched = allTerms(facts, query);
    const order = facts.order();
    const positions = Arr.sort(
        Arr.map(Array.from(matched), (id) => order.position(id)),
        Order.Number,
    );
    const subtree = (spanId: SpanId) => {
        const at = order.position(spanId);
        return countIn(positions, at, order.end(at));
    };
    return {
        text,
        query,
        active: true,
        matches: (spanId) => matched.has(spanId),
        positions,
        below: (spanId) => {
            const at = order.position(spanId);
            return countIn(positions, at + 1, order.end(at));
        },
        hiddenIn: (group, shown) => {
            const first = order.position(group.members[0] ?? "");
            const last = order.position(group.members[group.members.length - 1] ?? "");
            const all = countIn(positions, first, order.end(last));
            return all - Arr.reduce(shown, 0, (sum, id) => sum + subtree(id));
        },
        acrossSpans: positions.length === 0 && traceMatches(query, facts.trace),
    };
};

// oxlint-disable-next-line effect-native/imperative-collection-build -- a cache: filling it is the design.
const searches = new WeakMap<TreeFacts, SpanSearch>();

/** Memoized per trace for the last text searched, which is what the key step and the frame both ask for. */
export const searchOf = (facts: TreeFacts, text: string): SpanSearch => {
    const cached = searches.get(facts);
    if (cached !== undefined && cached.text === text) {
        return cached;
    }
    const search = build(facts, text);
    searches.set(facts, search);
    return search;
};

const matchesText = (n: number): string => (n === 1 ? "1 match" : `${count(n)} matches`);

/**
 * The tree search's state for the status line: `match 3/17` with a match selected, else `17 matches`, `no single span
 * matches all terms` or `no matches`. None without a search.
 */
export const matchText = (
    search: SpanSearch,
    facts: TreeFacts,
    entry: Option.Option<TreeEntry>,
): Option.Option<string> => {
    if (!search.active) {
        return Option.none();
    }
    const { positions } = search;
    if (positions.length === 0) {
        return Option.some(search.acrossSpans ? "no single span matches all terms" : "no matches");
    }
    const ordinal = Option.match(entry, {
        onNone: () => -1,
        onSome: (shown) =>
            shown._tag === "Span" && search.matches(shown.spanId)
                ? indexIn(positions, facts.order().position(shown.spanId))
                : -1,
    });
    return Option.some(
        ordinal >= 0 ? `match ${count(ordinal + 1)}/${count(positions.length)}` : matchesText(positions.length),
    );
};

/** ` · 3 matches` on a folded span or closed group that hides matches. */
export const hiddenText = (n: number): string => ` · ${matchesText(n)}`;
