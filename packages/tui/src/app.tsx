import { RegistryContext } from "@effect/atom-react";
import { NodeServices } from "@effect/platform-node";
import { type CliRenderer, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Deferred, Effect, Layer, Option } from "effect";
import { ChildProcessSpawner } from "effect/process";

import { Atoms } from "./bridge/Atoms.ts";
import { Bodies } from "./data/Bodies.ts";
import { InputFile } from "./data/InputFile.ts";
import { SpanSource } from "./data/SpanSource.ts";
import { SpanStore } from "./data/SpanStore.ts";
import { invocation, openEditor } from "./editor.ts";
import { App } from "./ui/App.tsx";

import type { CliArgs } from "./cli/Args.ts";
import type { EditTarget } from "./editor.ts";
import type { Nav } from "./nav/Nav.ts";

export const servicesLayer = (args: CliArgs, nav: Nav) =>
    Atoms.layer(nav).pipe(
        Layer.provide(Layer.mergeAll(SpanStore.layer.pipe(Layer.provide(SpanSource.layer)), Bodies.layer)),
        Layer.provide(InputFile.layer({ file: args.file, follow: args.follow })),
        Layer.provideMerge(NodeServices.layer),
    );

/** Shows the app on `renderer` until the user quits. */
export const runOn = Effect.fnUntraced(function* (renderer: CliRenderer, file: string) {
    const atoms = yield* Atoms;
    const quit = yield* Deferred.make<void>();
    const requestQuit = () => {
        Deferred.doneUnsafe(quit, Effect.void);
    };

    yield* Effect.acquireRelease(
        Effect.sync(() => process.on("SIGHUP", requestQuit)),
        () => Effect.sync(() => process.off("SIGHUP", requestQuit)),
    );

    // Raw mode delivers Ctrl-z as a key, not a signal, so suspending is ours to do.
    const suspend = () => {
        renderer.suspend();
        process.kill(process.pid, "SIGTSTP");
    };
    const resume = () => renderer.resume();
    const services = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
    const edit = (target: EditTarget) =>
        Effect.runForkWith(services)(
            openEditor(invocation(process.env, process.cwd(), target), renderer).pipe(
                Effect.tap((message) =>
                    Effect.sync(() => {
                        if (Option.isSome(message)) {
                            atoms.registry.set(atoms.message, message);
                        }
                    }),
                ),
            ),
        );
    yield* Effect.acquireRelease(
        Effect.sync(() => process.on("SIGCONT", resume)),
        () => Effect.sync(() => process.off("SIGCONT", resume)),
    );

    yield* Effect.sync(() =>
        createRoot(renderer).render(
            <RegistryContext.Provider value={atoms.registry}>
                <App
                    atoms={atoms}
                    file={file}
                    onQuit={requestQuit}
                    onSuspend={suspend}
                    onEdit={edit}
                    onCopy={(text) => renderer.copyToClipboardOSC52(text)}
                />
            </RegistryContext.Provider>,
        ),
    );
    yield* Deferred.await(quit);
});

export const run = (args: CliArgs, nav: Nav) =>
    Effect.scoped(
        Effect.gen(function* () {
            const renderer = yield* Effect.acquireRelease(
                Effect.promise(() =>
                    createCliRenderer({
                        // OpenTUI's own Ctrl-c and signal handling would destroy the renderer behind Effect's back.
                        exitOnCtrlC: false,
                        exitSignals: [],
                        screenMode: "alternate-screen",
                        useMouse: true,
                    }),
                ),
                (renderer) => Effect.sync(() => renderer.destroy()),
            );
            yield* runOn(renderer, args.file);
        }),
    ).pipe(Effect.provide(servicesLayer(args, nav)));
