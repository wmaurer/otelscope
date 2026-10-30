import { Data, Option, Predicate } from "effect";

import { Screen } from "../nav/Screen.ts";
import { isLive } from "./marks.ts";
import { runList } from "./runList.ts";
import { collect, pinnedBy, traceList } from "./traceList.ts";

import type { RunId, Snapshot, TraceId } from "../data/Snapshot.ts";
import type { RunSort, TraceSort } from "../nav/Screen.ts";
import type { RunList } from "./runList.ts";
import type { Collected, TraceList } from "./traceList.ts";
import type { HashSet } from "effect";

export type ScreenList =
    | { readonly _tag: "Runs"; readonly list: RunList }
    | { readonly _tag: "Traces"; readonly list: TraceList }
    | { readonly _tag: "None" };
export const ScreenList = Data.taggedEnum<ScreenList>();

const noList = ScreenList.None();

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

export const listKey = (screen: Screen, filter: string, snapshot: Snapshot, now: number): ListKey =>
    Screen.$match(screen, {
        Runs: (runs) => ListKey.Runs({ sort: runs.view.sort, reverse: runs.view.reverse, filter }),
        Traces: (traces) => {
            const { status } = snapshot;
            return ListKey.Traces({
                runId: traces.runId,
                sort: traces.view.sort,
                reverse: traces.view.reverse,
                filter,
                liveAt: isLive(status.lastRecordAt, status.phase, now) ? Option.some(now) : Option.none(),
            });
        },
        Trace: () => ListKey.None(),
        Body: () => ListKey.None(),
    });

export type Stage =
    | { readonly _tag: "Built"; readonly list: ScreenList }
    | { readonly _tag: "Collected"; readonly collected: Collected };
export const Stage = Data.taggedEnum<Stage>();

/** `previous` is the stage before this one, whose items `collect` keeps for the traces that did not change. */
export const stageOf = (key: ListKey, snapshot: Snapshot, previous: Option.Option<Stage>): Stage =>
    ListKey.$match(key, {
        Runs: (runs): Stage => Stage.Built({ list: ScreenList.Runs({ list: runList(snapshot, runs, runs.filter) }) }),
        Traces: (traces): Stage =>
            Option.match(
                collect(
                    snapshot,
                    traces.runId,
                    traces,
                    traces.filter,
                    traces.liveAt,
                    Option.flatMap(previous, (stage) =>
                        Predicate.isTagged(stage, "Collected") ? Option.some(stage.collected) : Option.none(),
                    ),
                ),
                {
                    onNone: (): Stage => Stage.Built({ list: noList }),
                    onSome: (collected): Stage => Stage.Collected({ collected }),
                },
            ),
        None: (): Stage => Stage.Built({ list: noList }),
    });

/** What lays collected traces out into rows: compared structurally, so a move that pins nothing rebuilds nothing. */
export interface Layout {
    readonly openGroups: HashSet.HashSet<string>;
    readonly pinned: Option.Option<TraceId>;
}

export const layoutOf = (stage: Stage, screen: Screen): Option.Option<Layout> =>
    Predicate.isTagged(stage, "Collected") && Predicate.isTagged(screen, "Traces")
        ? Option.some({
              openGroups: screen.view.openGroups,
              pinned: pinnedBy(stage.collected, screen.view.openGroups, screen.view.selected),
          })
        : Option.none();

export const assemble = (stage: Stage, layout: Option.Option<Layout>): ScreenList => {
    if (Predicate.isTagged(stage, "Built")) {
        return stage.list;
    }
    return Option.match(layout, {
        onNone: () => noList,
        onSome: ({ openGroups, pinned }) => ScreenList.Traces({ list: traceList(stage.collected, openGroups, pinned) }),
    });
};
