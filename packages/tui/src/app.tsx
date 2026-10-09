import { RegistryContext } from "@effect/atom-react";
import { NodeServices } from "@effect/platform-node";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Deferred, Effect, Layer } from "effect";

import { Atoms } from "./bridge/Atoms.ts";
import { Bodies } from "./data/Bodies.ts";
import { InputFile } from "./data/InputFile.ts";
import { SpanSource } from "./data/SpanSource.ts";
import { SpanStore } from "./data/SpanStore.ts";
import { App } from "./ui/App.tsx";

import type { CliArgs } from "./cli/Args.ts";

const servicesLayer = (args: CliArgs) =>
    Atoms.layer.pipe(
        Layer.provide(Layer.mergeAll(SpanStore.layer.pipe(Layer.provide(SpanSource.layer)), Bodies.layer)),
        Layer.provide(InputFile.layer({ file: args.file, follow: args.follow })),
        Layer.provide(NodeServices.layer),
    );

export const run = (args: CliArgs) =>
    Effect.scoped(
        Effect.gen(function* () {
            const { registry } = yield* Atoms;
            const quit = yield* Deferred.make<void>();
            const requestQuit = () => {
                Deferred.doneUnsafe(quit, Effect.void);
            };

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

            yield* Effect.acquireRelease(
                Effect.sync(() => process.on("SIGHUP", requestQuit)),
                () => Effect.sync(() => process.off("SIGHUP", requestQuit)),
            );

            yield* Effect.sync(() =>
                createRoot(renderer).render(
                    <RegistryContext.Provider value={registry}>
                        <App onQuit={requestQuit} />
                    </RegistryContext.Provider>,
                ),
            );
            yield* Deferred.await(quit);
        }),
    ).pipe(Effect.provide(servicesLayer(args)));
