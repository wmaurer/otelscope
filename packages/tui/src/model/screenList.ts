import { Data, Option } from "effect";

import { isLive } from "./marks.ts";
import { runList } from "./runList.ts";
import { collect, pinnedBy, traceList } from "./traceList.ts";

import type { RunId, Snapshot, TraceId } from "../data/Snapshot.ts";
import type { RunSort, Screen, TraceSort } from "../nav/Screen.ts";
import type { RunList } from "./runList.ts";
import type { Collected, TraceList } from "./traceList.ts";
import type { HashSet } from "effect";

export type ScreenList =
    | { readonly _tag: "Runs"; readonly list: RunList }
    | { readonly _tag: "Traces"; readonly list: TraceList }
    | { readonly _tag: "None" };

const noList: ScreenList = { _tag: "None" };

/** Everything a list's rows depend on besides the snapshot. Equal keys collect the same rows. */
export type ListKey = Data.TaggedEnum<{
    Runs: { readonly sort: RunSort; readonly reverse: boolean; readonly filter: string };
    Traces: {
        readonly runId: RunId;
        readonly sort: TraceSort;
        readonly reverse: boolean;
        readonly filter: string;
        /** The time liveness is judged at; None while nothing in the file can be live. */
        readonly liveAt: Option.Option<number>;
    };
    None: {};
}>;
export const ListKey = Data.taggedEnum<ListKey>();

export const listKey = (screen: Screen, filter: string, snapshot: Snapshot, now: number): ListKey => {
    switch (screen._tag) {
        case "Runs":
            return ListKey.Runs({ sort: screen.view.sort, reverse: screen.view.reverse, filter });
        case "Traces": {
            const { status } = snapshot;
            return ListKey.Traces({
                runId: screen.runId,
                sort: screen.view.sort,
                reverse: screen.view.reverse,
                filter,
                liveAt: isLive(status.lastRecordAt, status.phase, now) ? Option.some(now) : Option.none(),
            });
        }
        case "Trace":
        case "Body":
            return ListKey.None();
    }
};

export type Stage =
    | { readonly _tag: "Built"; readonly list: ScreenList }
    | { readonly _tag: "Collected"; readonly collected: Collected };

export const stageOf = (key: ListKey, snapshot: Snapshot): Stage =>
    ListKey.$match(key, {
        Runs: (runs): Stage => ({ _tag: "Built", list: { _tag: "Runs", list: runList(snapshot, runs, runs.filter) } }),
        Traces: (traces): Stage =>
            Option.match(collect(snapshot, traces.runId, traces, traces.filter, traces.liveAt), {
                onNone: (): Stage => ({ _tag: "Built", list: noList }),
                onSome: (collected): Stage => ({ _tag: "Collected", collected }),
            }),
        None: (): Stage => ({ _tag: "Built", list: noList }),
    });

/** What lays collected traces out into rows: compared structurally, so a move that pins nothing rebuilds nothing. */
export interface Layout {
    readonly openGroups: HashSet.HashSet<string>;
    readonly pinned: Option.Option<TraceId>;
}

export const layoutOf = (stage: Stage, screen: Screen): Option.Option<Layout> =>
    stage._tag === "Collected" && screen._tag === "Traces"
        ? Option.some({
              openGroups: screen.view.openGroups,
              pinned: pinnedBy(stage.collected, screen.view.openGroups, screen.view.selected),
          })
        : Option.none();

export const assemble = (stage: Stage, layout: Option.Option<Layout>): ScreenList => {
    if (stage._tag === "Built") {
        return stage.list;
    }
    return Option.match(layout, {
        onNone: () => noList,
        onSome: ({ openGroups, pinned }): ScreenList => ({
            _tag: "Traces",
            list: traceList(stage.collected, openGroups, pinned),
        }),
    });
};
