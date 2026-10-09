import { Array as Arr, Data, Option } from "effect";

import { Screen, TraceRow } from "./Screen.ts";

import type { Snapshot } from "../data/Snapshot.ts";
import type { Nav } from "./Nav.ts";

export type PrefixMatch = Data.TaggedEnum<{
    Found: { readonly id: string };
    Ambiguous: { readonly count: number };
    NotFound: {};
}>;
export const PrefixMatch = Data.taggedEnum<PrefixMatch>();

export const matchPrefix = (prefix: string, ids: ReadonlyMap<string, unknown>): PrefixMatch => {
    if (ids.has(prefix)) {
        return PrefixMatch.Found({ id: prefix });
    }
    let count = 0;
    let first = "";
    for (const id of ids.keys()) {
        if (id.startsWith(prefix)) {
            count += 1;
            first = id;
        }
    }
    if (count === 0) {
        return PrefixMatch.NotFound();
    }
    return count === 1 ? PrefixMatch.Found({ id: first }) : PrefixMatch.Ambiguous({ count });
};

interface Resolved {
    readonly noun: "run" | "trace";
    readonly prefix: string;
    readonly id: string;
}

const resolution = (screen: Screen, snapshot: Snapshot): Option.Option<Resolved> => {
    const resolve = (noun: Resolved["noun"], prefix: string, ids: ReadonlyMap<string, unknown>) => {
        const match = matchPrefix(prefix, ids);
        return match._tag === "Found" ? Option.some({ noun, prefix, id: match.id }) : Option.none();
    };
    if (screen._tag === "Traces" && screen.idIsPrefix) {
        return resolve("run", screen.runId, snapshot.runs);
    }
    if (screen._tag === "Trace" && screen.idIsPrefix) {
        return resolve("trace", screen.traceId, snapshot.traces);
    }
    return Option.none();
};

const follow = <A>(
    value: A,
    resolved: Option.Option<Resolved>,
    noun: Resolved["noun"],
    seeded: (value: A, prefix: string) => boolean,
    full: (id: string) => A,
): A =>
    Option.match(
        Option.filter(resolved, (r) => r.noun === noun && seeded(value, r.prefix)),
        { onNone: () => value, onSome: ({ id }) => full(id) },
    );

const rewrite = (
    screen: Screen,
    own: Option.Option<Resolved>,
    above: Option.Option<Resolved>,
    below: Option.Option<Resolved>,
): Screen =>
    Screen.$match(screen, {
        Runs: ({ view }) =>
            Screen.Runs({
                view: {
                    ...view,
                    selected: follow(view.selected, above, "run", Option.contains, Option.some),
                },
            }),
        Traces: ({ runId, idIsPrefix, view }) =>
            Screen.Traces({
                runId: Option.match(own, { onNone: () => runId, onSome: ({ id }) => id }),
                idIsPrefix: idIsPrefix && Option.isNone(own),
                view: {
                    ...view,
                    selected: follow(
                        view.selected,
                        above,
                        "trace",
                        (selected, prefix) =>
                            Option.exists(selected, (row) => row._tag === "Trace" && row.traceId === prefix),
                        (traceId) => Option.some(TraceRow.Trace({ traceId })),
                    ),
                },
            }),
        Trace: ({ traceId, idIsPrefix, viaRun, view }) =>
            Screen.Trace({
                traceId: Option.match(own, { onNone: () => traceId, onSome: ({ id }) => id }),
                idIsPrefix: idIsPrefix && Option.isNone(own),
                viaRun: follow(viaRun, below, "run", Option.contains, Option.some),
                view,
            }),
        Body: (body) => body,
    });

export const resolvePrefixes = (nav: Nav, snapshot: Snapshot): Nav => {
    const resolved = Arr.map(nav.stack, (screen) => resolution(screen, snapshot));
    if (!Arr.some(resolved, Option.isSome)) {
        return nav;
    }
    const at = (i: number) => Option.flatten(Arr.get(resolved, i));
    const [head, ...rest] = Arr.map(nav.stack, (screen, i) => rewrite(screen, at(i), at(i + 1), at(i - 1)));
    return head._tag === "Runs" ? { stack: [head, ...rest] } : nav;
};

export type Noun = "run" | "trace" | "span";

export type Presence = Data.TaggedEnum<{
    Present: {};
    Loading: { readonly noun: Noun; readonly id: string };
    Ambiguous: { readonly noun: Noun; readonly id: string; readonly count: number };
    NotInFile: { readonly noun: Noun; readonly id: string; readonly resetAt: Option.Option<number> };
}>;
export const Presence = Data.taggedEnum<Presence>();

export const presence = (screen: Screen, snapshot: Snapshot): Presence => {
    const check = (noun: Noun, id: string, idIsPrefix: boolean, ids: ReadonlyMap<string, unknown>): Presence => {
        const match = idIsPrefix
            ? matchPrefix(id, ids)
            : ids.has(id)
              ? PrefixMatch.Found({ id })
              : PrefixMatch.NotFound();
        if (match._tag === "Found") {
            return Presence.Present();
        }
        const phase = snapshot.status.phase;
        if (phase === "waiting" || phase === "loading") {
            return Presence.Loading({ noun, id });
        }
        return match._tag === "Ambiguous"
            ? Presence.Ambiguous({ noun, id, count: match.count })
            : Presence.NotInFile({ noun, id, resetAt: Option.map(snapshot.status.lastReset, ({ at }) => at) });
    };
    return Screen.$match(screen, {
        Runs: () => Presence.Present(),
        Traces: ({ runId, idIsPrefix }) => check("run", runId, idIsPrefix, snapshot.runs),
        Trace: ({ traceId, idIsPrefix }) => check("trace", traceId, idIsPrefix, snapshot.traces),
        Body: ({ traceId, spanId }) =>
            check("span", spanId, false, snapshot.traces.get(traceId)?.spans ?? new Map<string, unknown>()),
    });
};
