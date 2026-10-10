// The performance budgets of docs/specs/span-viewer/12-performance.md, measured on `huge`, loaded by perf/run.ts.
// Startup and the full index run in child processes (perf/startup.ts); everything else runs here, on the real data
// layer and the real App on a 120×40 test renderer. Both run the built app in dist/. `--json` prints the results as JSON,
// `--only idle,search` runs some sections, and any miss exits 1.

import { RegistryContext } from "@effect/atom-react";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { engine } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";
import {
    Array as Arr,
    Clock,
    Console,
    Context,
    Data,
    Deferred,
    Effect,
    FileSystem,
    Layer,
    Option,
    Order,
    Path,
    Schema,
    Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { createElement } from "react";

import { MarksJson } from "./marks.ts";

import type * as AppModule from "../src/app.tsx";
import type * as AtomsModule from "../src/bridge/Atoms.ts";
import type * as ListsModule from "../src/bridge/Lists.ts";
import type * as IndexModule from "../src/data/Index.ts";
import type { Snapshot, Status, Trace } from "../src/data/Snapshot.ts";
import type * as NavModule from "../src/nav/Nav.ts";
import type { Nav } from "../src/nav/Nav.ts";
import type * as ResolveModule from "../src/nav/Resolve.ts";
import type * as SeedModule from "../src/nav/Seed.ts";
import type * as MatchModule from "../src/query/Match.ts";
import type * as QueryModule from "../src/query/Query.ts";
import type * as AppViewModule from "../src/ui/App.tsx";

// The app comes from dist/, as users run it. tsx compiles with esbuild's `keepNames`, which wraps every named closure
// in a `__name` call when it is created, such as the `onNone` and `onSome` of each `Option.match`: from source, the
// Traces list's `collect` took 17.9 ms at p50 on `huge`, against 5.9 ms from dist/.
const dist = (path: string): string => new URL(`../dist/${path}`, import.meta.url).href;
// SAFETY: dist/ is src/ compiled by tsc, so each module has its source's types.
const { servicesLayer } = (await import(dist("app.js"))) as typeof AppModule;
// SAFETY: as above.
const { Atoms } = (await import(dist("bridge/Atoms.js"))) as typeof AtomsModule;
// SAFETY: as above.
const { SEARCH_DEBOUNCE_MILLIS } = (await import(dist("bridge/Lists.js"))) as typeof ListsModule;
// SAFETY: as above.
const { Index } = (await import(dist("data/Index.js"))) as typeof IndexModule;
// SAFETY: as above.
const { top } = (await import(dist("nav/Nav.js"))) as typeof NavModule;
// SAFETY: as above.
const { resolvePrefixes } = (await import(dist("nav/Resolve.js"))) as typeof ResolveModule;
// SAFETY: as above.
const { initialNav, openArrivedTrace } = (await import(dist("nav/Seed.js"))) as typeof SeedModule;
// SAFETY: as above.
const { traceMatches } = (await import(dist("query/Match.js"))) as typeof MatchModule;
// SAFETY: as above.
const { parse } = (await import(dist("query/Query.js"))) as typeof QueryModule;
// SAFETY: as above.
const { App } = (await import(dist("ui/App.js"))) as typeof AppViewModule;

const WIDTH = 120;
const HEIGHT = 40;
const PRESSES = 200;
const STARTUP_SPAWNS = 11;
const INDEX_SPAWNS = 3;
const LIVE_PUBLISHES = 300;
const LIVE_RECORDS_PER_PUBLISH = 500;
const LIVE_EVERY_MILLIS = 100;
const SPANS_PER_NEW_TRACE = 9;
const SEARCHES = 50;
// More than the 32 terms whose caches src/query/Match.ts keeps, so a query typed again is matched from scratch.
const EVICTING_TERMS = 40;
const PAGE_DOWN = "\u001b[6~";
const MB = 1024 * 1024;

type Judge = Data.TaggedEnum<{
    Median: { readonly limit: number };
    Tail: { readonly p95: number; readonly max: number };
    P95: { readonly limit: number };
    Worst: { readonly limit: number };
    Info: {};
}>;
const Judge = Data.taggedEnum<Judge>();

interface Result {
    readonly metric: string;
    readonly unit: "ms" | "MB";
    readonly samples: ReadonlyArray<number>;
    readonly judge: Judge;
    readonly note?: string | undefined;
}

interface Summary {
    readonly n: number;
    readonly median: number;
    readonly p95: number;
    readonly max: number;
}

const summarise = (samples: ReadonlyArray<number>): Summary => {
    const sorted = Arr.sort(samples, Order.Number);
    const n = sorted.length;
    const middle = Math.floor(n / 2);
    return {
        n,
        median: n % 2 === 1 ? sorted[middle] : ((sorted[middle - 1] ?? NaN) + (sorted[middle] ?? NaN)) / 2,
        p95: sorted[Math.ceil(0.95 * n) - 1] ?? NaN,
        max: sorted[n - 1] ?? NaN,
    };
};

const passes = (result: Result): boolean => {
    const summary = summarise(result.samples);
    return Judge.$match(result.judge, {
        Median: ({ limit }) => summary.median <= limit,
        Tail: ({ p95, max }) => summary.p95 <= p95 && summary.max <= max,
        P95: ({ limit }) => summary.p95 <= limit,
        Worst: ({ limit }) => summary.max <= limit,
        Info: () => true,
    });
};

const budgetText = (result: Result): string =>
    Judge.$match(result.judge, {
        Median: ({ limit }) => `median ≤ ${limit} ${result.unit}`,
        Tail: ({ p95, max }) => `p95 ≤ ${p95}, max ≤ ${max} ${result.unit}`,
        P95: ({ limit }) => `p95 ≤ ${limit} ${result.unit}`,
        Worst: ({ limit }) => `worst ≤ ${limit} ${result.unit}`,
        Info: () => "",
    });

const table = (results: ReadonlyArray<Result>): string => {
    const rows = Arr.map(results, (result) => {
        const summary = summarise(result.samples);
        const decimals = result.unit === "MB" ? 0 : 1;
        return [
            result.metric,
            budgetText(result),
            String(summary.n),
            summary.median.toFixed(decimals),
            summary.p95.toFixed(decimals),
            summary.max.toFixed(decimals),
            Judge.$is("Info")(result.judge) ? "info" : passes(result) ? "pass" : "FAIL",
            result.note ?? "",
        ];
    });
    const header = ["metric", "budget", "n", "median", "p95", "max", "result", ""];
    const widths = Arr.map(header, (title, column) =>
        Math.max(title.length, ...Arr.map(rows, (row) => row[column].length)),
    );
    const line = (cells: ReadonlyArray<string>) =>
        Arr.join(
            Arr.map(cells, (cell, column) =>
                column >= 2 && column <= 5 ? cell.padStart(widths[column]) : cell.padEnd(widths[column]),
            ),
            "  ",
        ).trimEnd();
    return Arr.join([line(header), ...Arr.map(rows, line)], "\n");
};

class ChildFailed extends Schema.TaggedError<ChildFailed>()("ChildFailed", {
    args: Schema.Array(Schema.String),
    exitCode: Schema.Finite,
    stderr: Schema.String,
}) {}

const spawnStartup = Effect.fnUntraced(function* (nodeFlags: ReadonlyArray<string>, args: ReadonlyArray<string>) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const path = yield* Path.Path;
    const all = [...nodeFlags, path.resolve(import.meta.dirname, "startup.ts"), ...args];
    return yield* Effect.scoped(
        Effect.gen(function* () {
            // CLOCK_MONOTONIC, like the child's `process.hrtime`, so the child's marks are comparable with it.
            const spawnedAt = process.hrtime.bigint();
            const child = yield* spawner.spawn(ChildProcess.make(process.execPath, all, { stdin: "ignore" }));
            const [stdout, stderr, exitCode] = yield* Effect.all(
                [
                    Stream.mkString(Stream.decodeText(child.stdout)),
                    Stream.mkString(Stream.decodeText(child.stderr)),
                    child.exitCode,
                ],
                { concurrency: "unbounded" },
            );
            if (exitCode !== 0) {
                return yield* new ChildFailed({ args: all, exitCode, stderr });
            }
            const marks = yield* Schema.decodeEffect(MarksJson)(stdout.trim());
            const since = (at: bigint) => Number(at - spawnedAt) / 1e6;
            return {
                firstFrame: since(marks.firstFrame),
                firstRows: since(marks.firstRows),
                indexed: Option.map(Option.fromUndefinedOr(marks.indexed), (indexed) => ({
                    done: since(indexed.done),
                    heapUsed: indexed.heapUsed / MB,
                    rss: indexed.rss / MB,
                })),
            };
        }),
    ).pipe(Effect.timeout("60 seconds"));
});

const startup = Effect.fnUntraced(function* (huge: string) {
    const runs = yield* Effect.forEach(Arr.range(1, STARTUP_SPAWNS), () => spawnStartup([], [huge]));
    // The first spawn fills the compile cache and the page cache.
    const measured = Arr.drop(runs, 1);
    return [
        {
            metric: "first frame",
            unit: "ms",
            samples: Arr.map(measured, (run) => run.firstFrame),
            judge: Judge.Median({ limit: 400 }),
        },
        {
            metric: "first rows",
            unit: "ms",
            samples: Arr.map(measured, (run) => run.firstRows),
            judge: Judge.Median({ limit: 750 }),
        },
    ] satisfies ReadonlyArray<Result>;
});

const fullIndex = Effect.fnUntraced(function* (huge: string) {
    const runs = yield* Effect.forEach(Arr.range(1, INDEX_SPAWNS), () =>
        spawnStartup(["--expose-gc"], ["--no-follow", huge]).pipe(Effect.map((run) => Option.getOrThrow(run.indexed))),
    );
    return [
        {
            metric: "full index",
            unit: "ms",
            samples: Arr.map(runs, (run) => run.done),
            judge: Judge.Median({ limit: 3000 }),
        },
        {
            metric: "memory: heap used",
            unit: "MB",
            samples: Arr.map(runs, (run) => run.heapUsed),
            judge: Judge.Worst({ limit: 400 }),
        },
        {
            metric: "memory: RSS",
            unit: "MB",
            samples: Arr.map(runs, (run) => run.rss),
            judge: Judge.Worst({ limit: 600 }),
        },
    ] satisfies ReadonlyArray<Result>;
});

type AtomsService = (typeof Atoms)["Service"];
type Screen = Awaited<ReturnType<typeof createTestRenderer>>;

/** The run with the most traces, and the trace with the most spans. */
interface Targets {
    readonly run: string;
    readonly trace: string;
    readonly traceSpans: number;
}

interface Scenario {
    readonly name: string;
    readonly screen: "traces" | "trace";
    /** Keys pressed, untimed, after the screen is shown. */
    readonly setup: ReadonlyArray<string>;
    /** The key of the nth timed press after the setup. */
    readonly key: (press: number) => string;
}

/** 50 rows down and back, from the top, so every press moves and the list scrolls. */
const upAndDown = (press: number): string => (press % 100 < 50 ? "j" : "k");

// In `huge` the run's 28,000 traces share a root name, so the Traces screen opens on one closed group, which the setup
// opens. The 10,000 siblings' parent is the trace's root, so folding the root is also folding the group's parent.
// The group itself is the other toggle.
const SCENARIOS: ReadonlyArray<Scenario> = [
    { name: "traces j/k", screen: "traces", setup: ["g", " "], key: upAndDown },
    { name: "traces PgDn", screen: "traces", setup: ["g", " "], key: () => PAGE_DOWN },
    { name: "trace j/k in the open group", screen: "trace", setup: ["g", "j", " ", "j"], key: upAndDown },
    { name: "trace fold/unfold the root", screen: "trace", setup: ["g", "j", " ", "g"], key: () => " " },
    { name: "trace close/open the group", screen: "trace", setup: ["g", "j"], key: () => " " },
];

const navFor = (targets: Targets, screen: Scenario["screen"]): Nav =>
    initialNav({
        run: Option.some(targets.run),
        trace: screen === "trace" ? Option.some(targets.trace) : Option.none(),
    });

/** What Atoms does with a seeded Nav when a snapshot arrives, done at once against the current snapshot. */
const show = (atoms: AtomsService, nav: Nav): void => {
    const snapshot = atoms.registry.get(atoms.snapshot);
    atoms.registry.set(atoms.nav, openArrivedTrace(resolvePrefixes(nav, snapshot), snapshot));
};

const shows = (snapshot: Snapshot, targets: Targets, screen: Scenario["screen"]): boolean =>
    screen === "traces"
        ? snapshot.runs.has(targets.run)
        : snapshot.traces.get(targets.trace)?.spanCount === targets.traceSpans;

const services = Effect.fnUntraced(function* (file: string, follow: boolean) {
    const context = yield* Layer.build(
        servicesLayer(
            { file, follow, run: Option.none(), trace: Option.none() },
            initialNav({ run: Option.none(), trace: Option.none() }),
        ),
    );
    return Context.get(context, Atoms);
});

/** What `testRender` of @opentui/react/test-utils does, with `flushSync` in place of `act`. */
const mount = Effect.fnUntraced(function* (atoms: AtomsService, file: string) {
    const screen = yield* Effect.acquireRelease(
        Effect.promise(() => createTestRenderer({ width: WIDTH, height: HEIGHT })),
        (screen) =>
            Effect.sync(() => {
                screen.renderer.destroy();
                // OpenTUI's animation engine and these globals hold the newest renderer after it is destroyed, which
                // would keep this screen's store alive into the next measurement.
                engine.detach();
                Reflect.deleteProperty(globalThis, "requestAnimationFrame");
                Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
                Reflect.deleteProperty(globalThis, "window");
            }),
    );
    const root = createRoot(screen.renderer);
    yield* Effect.acquireRelease(
        Effect.sync(() =>
            flushSync(() =>
                root.render(
                    createElement(
                        RegistryContext.Provider,
                        { value: atoms.registry },
                        createElement(App, {
                            atoms,
                            file,
                            onQuit: () => undefined,
                            onSuspend: () => undefined,
                            onEdit: () => undefined,
                            onCopy: () => true,
                        }),
                    ),
                ),
            ),
        ),
        () => Effect.sync(() => flushSync(() => root.unmount())),
    );
    yield* Effect.promise(() => screen.renderOnce());
    return screen;
});

interface Pressed {
    readonly ms: number;
    /** Whether the press changed the Nav, which shows that it did something. */
    readonly changed: boolean;
}

/**
 * `flushSync(key)` + `renderOnce()`, timed in one promise so no other fiber can run inside the measurement. React runs
 * its production build, as the bin loads it, which has no `act`; `flushSync` commits the key before the frame, as `act`
 * would.
 */
const press = (atoms: AtomsService, screen: Screen, key: string) =>
    Effect.promise((): Promise<Pressed> => {
        const before = atoms.registry.get(atoms.nav);
        const start = performance.now();
        flushSync(() => screen.mockInput.pressKey(key));
        return screen
            .renderOnce()
            .then(() => ({ ms: performance.now() - start, changed: atoms.registry.get(atoms.nav) !== before }));
    });

const untilSnapshot = Effect.fnUntraced(function* (atoms: AtomsService, done: (snapshot: Snapshot) => boolean) {
    const reached = yield* Deferred.make<Snapshot>();
    return yield* Effect.acquireUseRelease(
        Effect.sync(() =>
            atoms.registry.subscribe(
                atoms.snapshot,
                (snapshot) => {
                    if (done(snapshot)) {
                        Deferred.doneUnsafe(reached, Effect.succeed(snapshot));
                    }
                },
                { immediate: true },
            ),
        ),
        () => Deferred.await(reached),
        (unsubscribe) => Effect.sync(unsubscribe),
    );
});

const prepare = Effect.fnUntraced(function* (
    atoms: AtomsService,
    screen: Screen,
    targets: Targets,
    scenario: Scenario,
) {
    show(atoms, navFor(targets, scenario.screen));
    yield* Effect.forEach(scenario.setup, (key) => press(atoms, screen, key), { discard: true });
});

const pressResult = (
    label: string,
    scenario: Scenario,
    presses: ReadonlyArray<Pressed>,
    judge: Judge,
    note?: string,
): Result => ({
    metric: `key press ${label}: ${scenario.name}`,
    unit: "ms",
    samples: Arr.map(presses, (pressed) => pressed.ms),
    judge,
    note: Arr.join(
        [
            `${Arr.filter(presses, (pressed) => pressed.changed).length} changed the Nav`,
            ...(note === undefined ? [] : [note]),
        ],
        "; ",
    ),
});

const IDLE = Judge.Tail({ p95: 16, max: 50 });
const LOADING = Judge.Tail({ p95: 50, max: 100 });

const targetsOf = (snapshot: Snapshot): Targets => {
    const run = Arr.reduce(
        Arr.fromIterable(snapshot.runs.values()),
        Option.none<{ id: string; traces: number }>(),
        (best, run) =>
            Option.isSome(best) && best.value.traces >= run.traceIds.length
                ? best
                : Option.some({ id: run.id, traces: run.traceIds.length }),
    );
    const trace = Arr.reduce(Arr.fromIterable(snapshot.traces.values()), Option.none<Trace>(), (best, trace) =>
        Option.isSome(best) && best.value.spanCount >= trace.spanCount ? best : Option.some(trace),
    );
    return {
        run: Option.getOrThrow(run).id,
        trace: Option.getOrThrow(trace).id,
        traceSpans: Option.getOrThrow(trace).spanCount,
    };
};

/** Every query matched from scratch: `traceMatches` on the smallest trace pushes the query's terms out of the caches. */
const evictTermCaches = (snapshot: Snapshot): void => {
    const smallest = Arr.reduce(Arr.fromIterable(snapshot.traces.values()), Option.none<Trace>(), (best, trace) =>
        Option.isSome(best) && best.value.spanCount <= trace.spanCount ? best : Option.some(trace),
    );
    Arr.forEach(Arr.range(1, EVICTING_TERMS), (i) => {
        traceMatches(parse(`evict-${i}`), Option.getOrThrow(smallest));
    });
};

const SEARCH_QUERIES: ReadonlyArray<readonly [string, string]> = [
    ["a plain term", "unavailable"],
    ["key=value", "http.response.status_code=402"],
    ["is:failed", "is:failed"],
];

/** From the debounce timer firing to the frame that shows the filtered list. */
const search = Effect.fnUntraced(function* (atoms: AtomsService, screen: Screen, targets: Targets, query: string) {
    show(atoms, navFor(targets, "traces"));
    yield* Effect.promise(() => screen.renderOnce());
    evictTermCaches(atoms.registry.get(atoms.snapshot));
    yield* press(atoms, screen, "/");

    const filtered = yield* Deferred.make<{ readonly ms: number; readonly matched: number }>();
    let firedAt = Option.none<number>();
    const timers = globalThis.setTimeout;
    yield* Effect.acquireRelease(
        Effect.sync(() => {
            // The debounce in Lists.ts is an `Effect.sleep`, which Effect implements with the global `setTimeout`, so
            // wrapping it marks the moment the debounce fires.
            globalThis.setTimeout = Object.assign(
                (callback: () => void, delay?: number) =>
                    // @effect-diagnostics-next-line globalTimers:off
                    timers(
                        delay === SEARCH_DEBOUNCE_MILLIS
                            ? () => {
                                  firedAt = Option.some(performance.now());
                                  callback();
                              }
                            : callback,
                        delay,
                    ),
                timers,
            );
        }),
        () =>
            Effect.sync(() => {
                globalThis.setTimeout = timers;
            }),
    );
    yield* Effect.acquireRelease(
        Effect.sync(() =>
            atoms.registry.subscribe(atoms.list, (list) => {
                if (Option.isSome(firedAt) && list._tag === "Traces" && list.list.filter === query) {
                    const fired = firedAt.value;
                    // React commits this change in a microtask queued before this one, so the frame shows it.
                    void Promise.resolve()
                        .then(() => screen.renderOnce())
                        .then(() =>
                            Deferred.doneUnsafe(
                                filtered,
                                Effect.succeed({ ms: performance.now() - fired, matched: list.list.matched }),
                            ),
                        );
                }
            }),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
    );
    flushSync(() => Arr.forEach(Arr.fromIterable(query), (char) => screen.mockInput.pressKey(char)));
    const result = yield* Deferred.await(filtered);
    yield* press(atoms, screen, "\r");
    return result;
}, Effect.scoped);

const idleAndSearch = Effect.fnUntraced(function* (huge: string, sections: ReadonlySet<Section>) {
    const atoms = yield* services(huge, false);
    const snapshot = yield* untilSnapshot(atoms, (snapshot) => snapshot.status.phase === "done");
    const targets = targetsOf(snapshot);
    const screen = yield* mount(atoms, huge);
    const idle = yield* Effect.forEach(sections.has("idle") ? SCENARIOS : [], (scenario) =>
        Effect.gen(function* () {
            yield* prepare(atoms, screen, targets, scenario);
            const presses = yield* Effect.forEach(Arr.range(0, PRESSES - 1), (i) =>
                press(atoms, screen, scenario.key(i)),
            );
            return pressResult("idle", scenario, presses, IDLE);
        }),
    );
    const searches = yield* Effect.forEach(sections.has("search") ? SEARCH_QUERIES : [], ([label, query]) =>
        Effect.gen(function* () {
            const runs = yield* Effect.forEach(Arr.range(1, SEARCHES), () => search(atoms, screen, targets, query));
            const matched = Arr.dedupe(Arr.map(runs, (run) => run.matched));
            return {
                metric: `search: ${label} (${query})`,
                unit: "ms",
                samples: Arr.map(runs, (run) => run.ms),
                judge: Judge.P95({ limit: 100 }),
                note: `${Arr.join(Arr.map(matched, String), "/")} of ${snapshot.runs.get(targets.run)?.traceIds.length ?? 0} traces`,
            } satisfies Result;
        }),
    );
    return { targets, idle, searches };
}, Effect.scoped);

/** A copy of `huge` with the widest trace moved to the front: in `huge` it arrives in the last 4 % of the file. */
const reorderedCopy = Effect.fnUntraced(function* (huge: string, dir: string, targets: Targets) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(dir, "spans.jsonl");
    const lines = Arr.filter((yield* fs.readFileString(huge)).split("\n"), (line) => line.length > 0);
    const inWide = (line: string) => line.includes(`"trace":"${targets.trace}"`);
    const reordered = [...Arr.filter(lines, inWide), ...Arr.filter(lines, (line) => !inWide(line))];
    yield* fs.writeFileString(file, `${Arr.join(reordered, "\n")}\n`);
    yield* fs.symlink(path.join(path.dirname(huge), "bodies"), path.join(dir, "bodies"));
    return file;
});

const loading = (atoms: AtomsService): boolean => atoms.registry.get(atoms.snapshot).status.phase === "loading";

const whileLoading = Effect.fnUntraced(function* (huge: string, targets: Targets) {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* reorderedCopy(huge, yield* fs.makeTempDirectoryScoped(), targets);
    const samples = Arr.map(SCENARIOS, (): ReadonlyArray<Pressed> => []);
    let loads = 0;
    const next = () =>
        Arr.findFirstIndex(samples, (taken) => taken.length < PRESSES).pipe(
            Option.map((first) =>
                Arr.reduce(samples, first, (fewest, taken, i) => (taken.length < samples[fewest].length ? i : fewest)),
            ),
        );
    while (Option.isSome(next())) {
        const index = Option.getOrThrow(next());
        const scenario = SCENARIOS[index];
        loads += 1;
        yield* Effect.scoped(
            Effect.gen(function* () {
                const atoms = yield* services(file, false);
                const screen = yield* mount(atoms, file);
                yield* untilSnapshot(atoms, (snapshot) => shows(snapshot, targets, scenario.screen));
                yield* prepare(atoms, screen, targets, scenario);
                const taken = samples[index].length;
                while (loading(atoms) && samples[index].length < PRESSES) {
                    // Lets the store index a slice between presses.
                    yield* Effect.yieldNow;
                    if (loading(atoms)) {
                        samples[index] = [
                            ...samples[index],
                            yield* press(atoms, screen, scenario.key(samples[index].length - taken)),
                        ];
                    }
                }
            }),
        );
    }
    return Arr.map(SCENARIOS, (scenario, i) =>
        pressResult(
            "while loading",
            scenario,
            samples[i],
            LOADING,
            i === 0 ? `${loads} loads, widest trace first` : undefined,
        ),
    );
}, Effect.scoped);

/** 5,000 spans/s for 30 s, half into new traces and half into existing ones, made from the file's own records. */
const liveBatches = Effect.fnUntraced(function* (huge: string, traceIds: ReadonlyArray<string>, startMs: number) {
    const fs = yield* FileSystem.FileSystem;
    const head = Arr.take(
        Arr.filter((yield* fs.readFileString(huge)).split("\n", 5001), (line) => line.length > 0),
        5000,
    );
    const templates = yield* Effect.forEach(head, (line) =>
        Schema.decodeEffect(Schema.fromJsonString(JsonlSpanRecord))(line),
    );
    const encode = Schema.encodeEffect(Schema.fromJsonString(JsonlSpanRecord));
    return yield* Effect.forEach(Arr.range(0, LIVE_PUBLISHES - 1), (batch) =>
        Effect.forEach(Arr.range(1, LIVE_RECORDS_PER_PUBLISH), (i) => {
            const n = batch * LIVE_RECORDS_PER_PUBLISH + i;
            const template = templates[n % templates.length];
            return encode({
                ...template,
                trace:
                    i % 2 === 0
                        ? `live${String(Math.floor(n / (2 * SPANS_PER_NEW_TRACE))).padStart(28, "0")}`
                        : traceIds[(n * 7919) % traceIds.length],
                span: `l${String(n).padStart(15, "0")}`,
                parent: null,
                startMs: startMs + batch * LIVE_EVERY_MILLIS,
            });
        }).pipe(Effect.map((lines) => `${Arr.join(lines, "\n")}\n`)),
    );
});

interface Publish {
    readonly start: number;
    readonly freezeMs: number;
}

interface Published {
    /** From the start of `freeze` to the end of the frame. */
    readonly ms: number;
    readonly freezeMs: number;
    /** From the end of `freeze` to the snapshot atom's listeners, after the atoms that depend on it recomputed. */
    readonly noticeMs: number;
    /** From the snapshot atom's listeners to the end of the frame: React's commit and the renderer. */
    readonly drawMs: number;
    readonly screen: string;
    readonly shown: boolean;
}

const whileFollowing = Effect.fnUntraced(function* (huge: string, targets: Targets) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped();
    const file = path.join(dir, "spans.jsonl");
    yield* fs.copyFile(huge, file);
    yield* fs.symlink(path.join(path.dirname(huge), "bodies"), path.join(dir, "bodies"));

    const atoms = yield* services(file, true);
    const caughtUp = yield* untilSnapshot(atoms, (snapshot) => snapshot.status.phase === "following");
    const batches = yield* liveBatches(huge, caughtUp.traceOrder, yield* Clock.currentTimeMillis);
    const screen = yield* mount(atoms, file);

    let inFlight = Option.none<Publish>();
    let publishes: ReadonlyArray<Published> = [];
    // SAFETY: `freeze` is a method declared on `Index`, so its prototype holds it as a data property.
    const freeze = Object.getOwnPropertyDescriptor(Index.prototype, "freeze") as TypedPropertyDescriptor<
        IndexModule.Index["freeze"]
    >;
    yield* Effect.acquireRelease(
        Effect.sync(() =>
            Object.defineProperty(Index.prototype, "freeze", {
                configurable: true,
                value(this: IndexModule.Index, status: Status) {
                    const start = performance.now();
                    const snapshot = freeze.value?.call(this, status);
                    inFlight = Option.some({ start, freezeMs: performance.now() - start });
                    return snapshot;
                },
            }),
        ),
        () => Effect.sync(() => Object.defineProperty(Index.prototype, "freeze", freeze)),
    );
    const spans = new Intl.NumberFormat("en-US");
    yield* Effect.acquireRelease(
        Effect.sync(() =>
            atoms.registry.subscribe(atoms.snapshot, (snapshot) => {
                if (Option.isNone(inFlight)) {
                    return;
                }
                const publish = inFlight.value;
                const noticedAt = performance.now();
                // React commits the new snapshot in a microtask queued before this one, so the frame shows it.
                void Promise.resolve()
                    .then(() => screen.renderOnce())
                    .then(() => {
                        const drawnAt = performance.now();
                        publishes = [
                            ...publishes,
                            {
                                ms: drawnAt - publish.start,
                                freezeMs: publish.freezeMs,
                                noticeMs: noticedAt - publish.start - publish.freezeMs,
                                drawMs: drawnAt - noticedAt,
                                screen: top(atoms.registry.get(atoms.nav))._tag,
                                shown: screen.captureCharFrame().includes(`${spans.format(snapshot.spanCount)} spans`),
                            },
                        ];
                        inFlight = Option.none();
                    });
            }),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
    );

    const writer = Effect.forEach(
        batches,
        (batch) => fs.writeFileString(file, batch, { flag: "a" }).pipe(Effect.andThen(Effect.sleep(LIVE_EVERY_MILLIS))),
        { discard: true },
    );
    const slotMillis = (LIVE_PUBLISHES * LIVE_EVERY_MILLIS) / (SCENARIOS.length * PRESSES);
    const notPublishing: Effect.Effect<void> = Effect.suspend(() =>
        Option.isSome(inFlight) ? Effect.andThen(Effect.yieldNow, notPublishing) : Effect.void,
    );
    const presses = Effect.forEach(SCENARIOS, (scenario) =>
        Effect.gen(function* () {
            yield* notPublishing;
            yield* prepare(atoms, screen, targets, scenario);
            const samples = yield* Effect.forEach(Arr.range(0, PRESSES - 1), (i) =>
                Effect.gen(function* () {
                    yield* notPublishing;
                    const pressed = yield* press(atoms, screen, scenario.key(i));
                    yield* Effect.sleep(Math.max(0, slotMillis - pressed.ms));
                    return pressed;
                }),
            );
            return pressResult("while following", scenario, samples, IDLE);
        }),
    );
    const [, following] = yield* Effect.all([writer, presses], { concurrency: 2 });
    yield* Effect.sleep(LIVE_EVERY_MILLIS * 3);
    yield* notPublishing;
    const shown = Arr.filter(publishes, (publish) => publish.shown).length;
    return {
        publish: [
            {
                metric: "live publish: freeze + re-render, all screens",
                unit: "ms",
                samples: Arr.map(publishes, (publish) => publish.ms),
                judge: Judge.Info(),
                note: `${shown} of ${publishes.length} frames showed the published span count`,
            },
            {
                metric: "live publish: freeze alone",
                unit: "ms",
                samples: Arr.map(publishes, (publish) => publish.freezeMs),
                judge: Judge.Info(),
            },
            {
                metric: "live publish: freeze to the snapshot's listeners",
                unit: "ms",
                samples: Arr.map(publishes, (publish) => publish.noticeMs),
                judge: Judge.Info(),
            },
            {
                metric: "live publish: listeners to the frame",
                unit: "ms",
                samples: Arr.map(publishes, (publish) => publish.drawMs),
                judge: Judge.Info(),
            },
            // Each screen meets the budget on its own: the Trace screen's cheap publishes must not hide the Traces
            // screen's, where the list over every trace of the run is the user's worst case while following.
            ...Arr.map(["Traces", "Trace"], (tag) => ({
                metric: `live publish: on the ${tag} screen`,
                unit: "ms" as const,
                samples: Arr.map(
                    Arr.filter(publishes, (publish) => publish.screen === tag),
                    (publish) => publish.ms,
                ),
                judge: IDLE,
            })),
        ] satisfies ReadonlyArray<Result>,
        following,
    };
}, Effect.scoped);

class BudgetsMissed extends Schema.TaggedError<BudgetsMissed>()("BudgetsMissed", {
    metrics: Schema.Array(Schema.String),
}) {
    override get message(): string {
        return Arr.join(this.metrics, ", ");
    }
}

const ensureHuge = Effect.fnUntraced(function* (huge: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (yield* fs.exists(huge)) {
        return;
    }
    yield* Console.error(`${huge} is missing; generating it once (about 75 s)`);
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const exitCode = yield* spawner.exitCode(
        ChildProcess.make("pnpm", ["exec", "tsx", "packages/effect/scripts/sample-fixture.ts", "huge"], {
            cwd: path.resolve(import.meta.dirname, "../../.."),
            stdin: "ignore",
            stdout: "inherit",
            stderr: "inherit",
        }),
    );
    if (exitCode !== 0) {
        return yield* new ChildFailed({ args: ["sample-fixture.ts", "huge"], exitCode, stderr: "" });
    }
});

const SECTIONS = ["startup", "index", "idle", "loading", "following", "search"] as const;

type Section = (typeof SECTIONS)[number];

/** `--only idle,search` runs some sections; the default is all of them. */
const sectionsOf = (argv: ReadonlyArray<string>): ReadonlySet<Section> => {
    const only = Arr.findFirstIndex(argv, (arg) => arg === "--only");
    const names = Option.match(only, {
        onNone: () => SECTIONS,
        onSome: (i) => Arr.filter(SECTIONS, (section) => Arr.contains((argv[i + 1] ?? "").split(","), section)),
    });
    return new Set(names);
};

const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const argv = Arr.drop(process.argv, 2);
    const json = Arr.contains(argv, "--json");
    const sections = sectionsOf(argv);
    const huge = path.resolve(import.meta.dirname, "../test/fixtures/huge/spans.jsonl");
    yield* ensureHuge(huge);
    const loadBefore = (yield* fs.readFileString("/proc/loadavg")).trim();

    const startupResults = sections.has("startup") ? yield* startup(huge) : [];
    const indexResults = sections.has("index") ? yield* fullIndex(huge) : [];
    const inProcess = Arr.some(["idle", "search", "loading", "following"] as const, (section) => sections.has(section));
    const { targets, idle, searches } = inProcess
        ? yield* idleAndSearch(huge, sections)
        : { targets: undefined, idle: [], searches: [] };
    const loadingResults = targets !== undefined && sections.has("loading") ? yield* whileLoading(huge, targets) : [];
    const live =
        targets !== undefined && sections.has("following")
            ? yield* whileFollowing(huge, targets)
            : { publish: [], following: [] };
    const loadAfter = (yield* fs.readFileString("/proc/loadavg")).trim();

    const results: ReadonlyArray<Result> = [
        ...startupResults,
        ...indexResults,
        ...idle,
        ...loadingResults,
        ...live.publish,
        ...live.following,
        ...searches,
    ];
    if (json) {
        yield* Console.log(
            yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
                loadBefore,
                loadAfter,
                targets,
                results: Arr.map(results, (result) => ({
                    metric: result.metric,
                    budget: budgetText(result),
                    ...summarise(result.samples),
                    pass: passes(result),
                    note: result.note ?? null,
                })),
            }),
        );
    } else {
        if (targets !== undefined) {
            yield* Console.log(`huge: run ${targets.run}, trace ${targets.trace} (${targets.traceSpans} spans)`);
        }
        yield* Console.log(`load average before: ${loadBefore}; after: ${loadAfter}`);
        yield* Console.log(table(results));
    }
    const missed = Arr.map(
        Arr.filter(results, (result) => !passes(result)),
        (result) => result.metric,
    );
    if (missed.length > 0) {
        return yield* new BudgetsMissed({ metrics: missed });
    }
}).pipe(
    Effect.tapError((error) => Console.error(`perf: ${error._tag}: ${error.message}`)),
    Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
