// Regenerates the span-viewer fixtures in `packages/tui/test/fixtures/`, by tracing four small Effect programs,
// one run each, into one JSONL file:
//
//     pnpm exec tsx packages/effect/scripts/sample-fixture.ts [sample|large|huge]
//
// `sample/` is committed and byte-stable across regenerations; `large/` and `huge/` are gitignored. With no
// argument, `sample/` and `large/` are rewritten; `huge/` is written only when asked for. The scenarios are in
// `fixture/scenarios.ts`, and how the output is made stable is described in `fixture/VirtualTime.ts` and
// `makeNormaliser` in `fixture/FixtureWriter.ts`.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
    Array as Arr,
    Clock,
    Console,
    Effect,
    FileSystem,
    Logger,
    Path,
    Random,
    References,
    Scheduler,
    Schema,
} from "effect";

import * as FixtureWriter from "./fixture/FixtureWriter.ts";
import { batchJobs, HUGE, LARGE, SAMPLE, type Scale, shopApi, supportAgent, worker } from "./fixture/scenarios.ts";
import * as VirtualTime from "./fixture/VirtualTime.ts";

// 2026-10-06T14:03:27Z, the start of the first run.
const EPOCH_MILLIS = 1_791_295_407_000;
const SEED = "otelscope-fixture";

const VARIANTS = { sample: SAMPLE, large: LARGE, huge: HUGE } satisfies Record<string, Scale>;
const Variant = Schema.UndefinedOr(Schema.Literals(["sample", "large", "huge"]));

const RUNS = [
    ["shop-api", shopApi],
    ["support-agent", supportAgent],
    ["batch-jobs", batchJobs],
    ["worker", worker],
] as const;

const Line = Schema.fromJsonString(Schema.Struct({ trace: Schema.String, events: Schema.Array(Schema.Unknown) }));

const generate = Effect.fnUntraced(function* (name: string, scale: Scale) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    const dir = path.join(repoRoot, "packages/tui/test/fixtures", name);
    const file = path.join(dir, "spans.jsonl");
    yield* fs.remove(dir, { recursive: true, force: true });

    const liveClock = yield* Clock.Clock;
    const time = VirtualTime.make(EPOCH_MILLIS, 1);
    const normalise = FixtureWriter.makeNormaliser(repoRoot);

    yield* Effect.forEach(
        RUNS,
        ([service, program], index) =>
            Effect.andThen(
                Effect.sleep(index === 0 ? "0 millis" : "2 minutes"),
                program(scale).pipe(
                    Effect.provide(
                        FixtureWriter.layer({
                            file,
                            service,
                            run: `run-${index.toString()}`,
                            normalise,
                            liveClock,
                            hold: time.hold,
                        }),
                    ),
                ),
            ),
        { discard: true },
    ).pipe(
        Random.withSeed(SEED),
        Effect.provideService(References.MinimumLogLevel, "All"),
        Effect.provideService(Logger.CurrentLoggers, new Set([Logger.tracerLogger])),
        Effect.provideService(Clock.Clock, time.clock),
        Effect.provideService(Scheduler.Scheduler, time.scheduler),
    );

    const lines = Arr.filter((yield* fs.readFileString(file)).split("\n"), (line) => line.length > 0);
    const records = yield* Effect.forEach(lines, (line) => Schema.decodeEffect(Line)(line));
    const bodies = yield* fs.readDirectory(path.join(dir, "bodies"));
    const { size } = yield* fs.stat(file);
    yield* Console.log(
        `${name}: ${lines.length.toString()} spans, ${new Set(Arr.map(records, (r) => r.trace)).size.toString()} traces, ` +
            `${Arr.reduce(records, 0, (n, r) => n + r.events.length).toString()} events, ${bodies.length.toString()} bodies, ` +
            `${(Number(size) / 1_000_000).toFixed(1)} MB of JSONL in ${path.relative(repoRoot, dir)}`,
    );
});

const main = Effect.gen(function* () {
    const only = yield* Schema.decodeUnknownEffect(Variant)(process.argv[2]);
    const names = only === undefined ? (["sample", "large"] as const) : [only];
    for (const name of names) yield* generate(name, VARIANTS[name]);
});

NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)));
