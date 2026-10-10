import { Option } from "effect";

import { logList } from "./logs.ts";
import { flatten, rowKey, rowOf, shownIndex, visibilityOf } from "./tree.ts";
import { factsOf } from "./treeFacts.ts";
import { searchOf } from "./treeSearch.ts";

import type { Trace } from "../data/Snapshot.ts";
import type { LogScope, TraceView, TreeRow } from "../nav/Screen.ts";
import type { LogList } from "./logs.ts";
import type { Tree, TreeEntry } from "./tree.ts";
import type { TreeFacts } from "./treeFacts.ts";
import type { SpanSearch } from "./treeSearch.ts";

/** Everything the Trace screen's keys and frame read, derived from the trace and the view. */
export interface TraceModel {
    readonly facts: TreeFacts;
    readonly tree: Tree;
    readonly search: SpanSearch;
    /** The row the selection shows as (`shownIndex`), -1 for an empty tree. */
    readonly index: number;
    readonly entry: Option.Option<TreeEntry>;
    readonly logs: LogList;
}

export interface Chosen {
    readonly index: number;
    readonly entry: Option.Option<TreeEntry>;
}

export const chosenOf = (facts: TreeFacts, tree: Tree, view: TraceView): Chosen => {
    const index = shownIndex(tree, facts, view.selected);
    return { index, entry: Option.fromUndefinedOr(tree.rows[index]) };
};

/** What the logs depend on besides the trace. Compared structurally, so a tree move under `trace` scope rebuilds nothing. */
export interface LogsKey {
    readonly scope: LogScope;
    /** The shown row the scope is taken from; None under `trace` scope. */
    readonly anchor: Option.Option<TreeRow>;
    /** The settled log filter. */
    readonly filter: string;
}

export const logsKeyOf = (view: TraceView, entry: Option.Option<TreeEntry>, filter: string): LogsKey => ({
    scope: view.logScope,
    anchor: view.logScope === "trace" ? Option.none() : Option.map(entry, rowOf),
    filter,
});

export const logsOfKey = (facts: TreeFacts, tree: Tree, key: LogsKey): LogList =>
    logList(
        facts,
        Option.flatMap(key.anchor, (row) => Option.fromUndefinedOr(tree.rows[tree.indexOf(rowKey(row))])),
        key.scope,
        key.filter,
    );

/** The same stages the bridge memoizes, composed without caching: for tests and one-off uses. */
export const traceModelOf = (trace: Trace, view: TraceView, logFilter: string): TraceModel => {
    const facts = factsOf(trace);
    const tree = flatten(facts, visibilityOf(facts, view));
    const chosen = chosenOf(facts, tree, view);
    return {
        facts,
        tree,
        search: searchOf(facts, view.search),
        ...chosen,
        logs: logsOfKey(facts, tree, logsKeyOf(view, chosen.entry, logFilter)),
    };
};
