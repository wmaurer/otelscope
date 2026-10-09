import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Deferred, Effect } from "effect";

import { App } from "./ui/App.tsx";

export const run = Effect.scoped(
    Effect.gen(function* () {
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

        yield* Effect.sync(() => createRoot(renderer).render(<App onQuit={requestQuit} />));
        yield* Deferred.await(quit);
    }),
);
