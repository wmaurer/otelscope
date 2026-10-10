import { RegistryContext } from "@effect/atom-react";
import { NodeServices } from "@effect/platform-node";
import { testRender } from "@opentui/react/test-utils";
import { Clock, Context, Effect, Exit, Layer, type PlatformError, Scope } from "effect";
import { act } from "react";

import { Atoms } from "../../src/bridge/Atoms.ts";
import { SEARCH_DEBOUNCE_MILLIS } from "../../src/bridge/Lists.ts";
import { Bodies } from "../../src/data/Bodies.ts";
import { InputFile } from "../../src/data/InputFile.ts";
import { App } from "../../src/ui/App.tsx";

import type { SpanStore } from "../../src/data/SpanStore.ts";
import type { EditTarget } from "../../src/editor.ts";
import type { Nav } from "../../src/nav/Nav.ts";

export interface MountOptions {
    /** The JSONL file. Bodies are read from the `bodies/` directory beside it. */
    readonly file: string;
    readonly follow: boolean;
    readonly store: Layer.Layer<SpanStore, PlatformError.PlatformError, InputFile | NodeServices.NodeServices>;
    readonly nav: Nav;
    readonly width: number;
    readonly height: number;
    /** Fixes the time the `Atoms` layer reads. Its sleeps stay real, so the store's throttle and the debounces run. */
    readonly now?: number | undefined;
}

const fixedClock = (millis: number) =>
    Layer.effect(
        Clock.Clock,
        Clock.clockWith((real) =>
            Effect.succeed(
                Clock.Clock.of({
                    currentTimeMillisUnsafe: () => millis,
                    currentTimeMillis: Effect.succeed(millis),
                    currentTimeNanosUnsafe: () => BigInt(millis) * 1_000_000n,
                    currentTimeNanos: Effect.succeed(BigInt(millis) * 1_000_000n),
                    monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
                    monotonicTimeNanos: real.monotonicTimeNanos,
                    sleep: (duration) => real.sleep(duration),
                }),
            ),
        ),
    );

/** Mounts the real `App` over the real `Atoms`, `Bodies` and `InputFile` layers and the given `SpanStore`. */
export const mount = async (options: MountOptions) => {
    const scope = Scope.makeUnsafe();
    const atomsLayer =
        options.now === undefined
            ? Atoms.layer(options.nav)
            : Atoms.layer(options.nav).pipe(Layer.provide(fixedClock(options.now)));
    const context = await Effect.runPromise(
        Layer.buildWithScope(
            atomsLayer.pipe(
                Layer.provide(Layer.mergeAll(options.store, Bodies.layer)),
                Layer.provide(InputFile.layer({ file: options.file, follow: options.follow })),
                Layer.provide(NodeServices.layer),
            ),
            scope,
        ),
    );
    const atoms = Context.get(context, Atoms);
    let quits = 0;
    let suspends = 0;
    const edits: Array<EditTarget> = [];
    const copies: Array<string> = [];
    const setup = await testRender(
        <RegistryContext.Provider value={atoms.registry}>
            <App
                atoms={atoms}
                file={options.file}
                onQuit={() => (quits += 1)}
                onSuspend={() => (suspends += 1)}
                onEdit={(target) => {
                    edits[edits.length] = target;
                }}
                onCopy={(text) => {
                    copies[copies.length] = text;
                    return true;
                }}
            />
        </RegistryContext.Provider>,
        { width: options.width, height: options.height },
    );
    const frame = async () => {
        await setup.renderOnce();
        return setup.captureCharFrame();
    };
    /** Runs `effect` inside `act()`, so the updates it causes reach the screen, then takes a frame. */
    const after = async <A, E>(effect: Effect.Effect<A, E>) => {
        await act(() => Effect.runPromise(Effect.asVoid(effect)));
        return frame();
    };
    const press = async (key: string, modifiers?: { readonly ctrl?: boolean }) => {
        act(() => setup.mockInput.pressKey(key, modifiers));
        return frame();
    };
    const escape = async () => {
        act(() => setup.mockInput.pressEscape());
        // A lone ESC byte could start an escape sequence, so the input parser waits 20 ms before it reports the key.
        return after(Effect.sleep(50));
    };
    const enter = async () => {
        act(() => setup.mockInput.pressEnter());
        return frame();
    };
    const type = async (text: string) => {
        await act(() => setup.mockInput.typeText(text));
        return frame();
    };
    const settle = () => after(Effect.sleep(SEARCH_DEBOUNCE_MILLIS + 50));
    const click = async (x: number, y: number) => {
        await act(() => setup.mockMouse.click(x, y));
        return frame();
    };
    const drag = async (from: number, to: number) => {
        await act(() => setup.mockMouse.drag(10, from, 10, to));
        return frame();
    };
    const wheel = async (x: number, y: number, direction: "up" | "down") => {
        await act(() => setup.mockMouse.scroll(x, y, direction));
        return frame();
    };
    const stop = async () => {
        // The renderer unmounts the React root when it is destroyed, and React wants that inside act().
        act(() => setup.renderer.destroy());
        await Effect.runPromise(Scope.close(scope, Exit.void));
    };
    return {
        atoms,
        frame,
        after,
        press,
        escape,
        enter,
        type,
        settle,
        click,
        drag,
        wheel,
        stop,
        quits: () => quits,
        suspends: () => suspends,
        edits: () => edits,
        copies: () => copies,
    };
};
