// The startup child of perf/run.ts, run as `node perf/startup.ts <otelscope args>`. It repeats src/bin.ts and
// src/main.ts on the built code in dist/, with two differences: it skips the TTY check, and it mounts the app on a
// 120×40 test renderer rather than the terminal. It prints one JSON line of `process.hrtime` marks, which share
// CLOCK_MONOTONIC with the parent, so the parent times them from its spawn (perf/marks.ts).
// @effect-diagnostics processEnv:off

import type * as AppModule from "../src/app.tsx";
import type * as AtomsModule from "../src/bridge/Atoms.ts";
import type * as ArgsModule from "../src/cli/Args.ts";
import type * as StartupModule from "../src/cli/Startup.ts";
import type * as SeedModule from "../src/nav/Seed.ts";
import type * as ProductionReactModule from "../src/productionReact.ts";

if (process.versions.bun === undefined && process.getBuiltinModule?.("node:ffi") === undefined) {
    process.stderr.write(`otelscope needs Node >= 26.9 (found ${process.version}).\n`);
    process.exit(1);
}

if (process.platform === "linux" && process.env.OPENTUI_LIBC === undefined) {
    // SAFETY: as in src/bin.ts.
    const report = process.report.getReport() as { readonly header: { readonly glibcVersionRuntime?: string } };
    if (report.header.glibcVersionRuntime === undefined) {
        process.env.OPENTUI_LIBC = "musl";
    }
}

const nodeWarningListeners = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (warning) => {
    if (warning.name === "ExperimentalWarning" && warning.message.startsWith("FFI ")) {
        return;
    }
    for (const listener of nodeWarningListeners) {
        listener(warning);
    }
});

process.getBuiltinModule("node:module").enableCompileCache();

const dist = (path: string): string => new URL(`../dist/${path}`, import.meta.url).href;

const { NodeRuntime, NodeServices } = await import("@effect/platform-node");
const { Array: Arr, Console, Deferred, Effect, Option, Schema } = await import("effect");
const { MarksJson } = await import("./marks.ts");
// SAFETY: dist/ is src/ compiled by tsc, so each module has its source's types.
const Args = (await import(dist("cli/Args.js"))) as typeof ArgsModule;
// SAFETY: as above.
const Startup = (await import(dist("cli/Startup.js"))) as typeof StartupModule;
// SAFETY: as above.
const { initialNav } = (await import(dist("nav/Seed.js"))) as typeof SeedModule;
// SAFETY: as above.
const { withProductionReact } = (await import(dist("productionReact.js"))) as typeof ProductionReactModule;

const program = Effect.gen(function* () {
    const args = yield* Args.parse(Arr.drop(process.argv, 2));
    if (Option.isNone(args)) {
        return;
    }
    yield* Startup.check(args.value, { stdin: true, stdout: true });
    const nav = initialNav(args.value);
    // SAFETY: as above.
    const app = (yield* withProductionReact(Effect.promise(() => import(dist("app.js"))))) as typeof AppModule;
    // SAFETY: as above.
    const { Atoms } = (yield* Effect.promise(() => import(dist("bridge/Atoms.js")))) as typeof AtomsModule;
    const { createTestRenderer } = yield* Effect.promise(() => import("@opentui/core/testing"));

    const marks = yield* Effect.scoped(
        Effect.gen(function* () {
            const atoms = yield* Atoms;
            const setup = yield* Effect.acquireRelease(
                Effect.promise(() => createTestRenderer({ width: 120, height: 40 })),
                ({ renderer }) => Effect.sync(() => renderer.destroy()),
            );
            const firstFrame = yield* Deferred.make<bigint>();
            const firstRows = yield* Deferred.make<bigint>();
            const done = yield* Deferred.make<bigint>();
            // The renderer draws on demand, as the real one does, so no frame is forced here.
            const onFrame = () => {
                const at = process.hrtime.bigint();
                Deferred.doneUnsafe(firstFrame, Effect.succeed(at));
                const frame = setup.captureCharFrame();
                if (Arr.some(atoms.registry.get(atoms.snapshot).runOrder, (run) => frame.includes(run))) {
                    Deferred.doneUnsafe(firstRows, Effect.succeed(at));
                }
            };
            yield* Effect.acquireRelease(
                Effect.sync(() => setup.renderer.on("frame", onFrame)),
                () => Effect.sync(() => setup.renderer.off("frame", onFrame)),
            );
            yield* Effect.acquireRelease(
                Effect.sync(() =>
                    atoms.registry.subscribe(
                        atoms.snapshot,
                        (snapshot) => {
                            if (snapshot.status.phase === "done") {
                                Deferred.doneUnsafe(done, Effect.succeed(process.hrtime.bigint()));
                            }
                        },
                        { immediate: true },
                    ),
                ),
                (unsubscribe) => Effect.sync(unsubscribe),
            );
            yield* app.runOn(setup.renderer, args.value.file).pipe(Effect.forkScoped);

            const startup = {
                firstFrame: yield* Deferred.await(firstFrame),
                firstRows: yield* Deferred.await(firstRows),
            };
            if (args.value.follow) {
                return startup;
            }
            const indexed = yield* Deferred.await(done);
            if (globalThis.gc === undefined) {
                return yield* Effect.die(new Error("run with --expose-gc to measure memory"));
            }
            globalThis.gc();
            const memory = process.memoryUsage();
            return { ...startup, indexed: { done: indexed, heapUsed: memory.heapUsed, rss: memory.rss } };
        }),
    ).pipe(Effect.provide(app.servicesLayer(args.value, nav)));
    yield* Console.log(yield* Schema.encodeEffect(MarksJson)(marks));
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
