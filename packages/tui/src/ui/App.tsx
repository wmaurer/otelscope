import { useAtomValue } from "@effect/atom-react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { Array as Arr, Option } from "effect";
import { useRef, useState } from "react";

import { Action } from "../keys/Action.ts";
import { dispatch } from "../keys/Dispatch.ts";
import { initialKeyState, modeOf, ShellEffect, stepShell } from "../keys/Shell.ts";
import { overlayContent, overlayExtent } from "../model/overlays.ts";
import { Frame, listRows } from "./Frame.tsx";

import type { Atoms } from "../bridge/Atoms.ts";
import type { KeyState } from "../keys/Shell.ts";
import type { ReactNode } from "react";

export interface AppProps {
    readonly atoms: (typeof Atoms)["Service"];
    /** Absolute. */
    readonly file: string;
    readonly onQuit: () => void;
    readonly onSuspend: () => void;
}

export const App = (props: AppProps): ReactNode => {
    const { atoms } = props;
    const nav = useAtomValue(atoms.nav);
    const snapshot = useAtomValue(atoms.snapshot);
    const now = useAtomValue(atoms.now);
    const message = useAtomValue(atoms.message);
    const list = useAtomValue(atoms.list);
    const { width, height } = useTerminalDimensions();
    const [keys, setKeys] = useState<KeyState>(initialKeyState);
    // Two keys can arrive before React renders again, and the second must see what the first opened.
    const current = useRef<KeyState>(initialKeyState);

    const apply = (action: Action) => {
        const registry = atoms.registry;
        const before = registry.get(atoms.nav);
        const latest = registry.get(atoms.snapshot);
        const state = current.current;
        const step = stepShell(
            state,
            {
                nav: before,
                snapshot: latest,
                list: registry.get(atoms.list),
                listRows: listRows(height),
                overlay:
                    state.shell._tag === "Overlay"
                        ? overlayExtent(overlayContent(state.shell.kind, before, latest), { width, height })
                        : { total: 0, viewport: 0 },
            },
            action,
        );
        current.current = step.state;
        setKeys(step.state);
        if (step.nav !== before) {
            registry.set(atoms.nav, step.nav);
        }
        Arr.forEach(step.effects, (effect) =>
            ShellEffect.$match(effect, {
                Quit: () => props.onQuit(),
                Suspend: () => props.onSuspend(),
                Say: ({ text }) => registry.set(atoms.message, Option.some(text)),
            }),
        );
    };

    useKeyboard((key) => {
        atoms.keyPressed();
        const action = dispatch(modeOf(current.current.shell), atoms.registry.get(atoms.nav), key);
        if (Option.isSome(action)) {
            apply(action.value);
        }
    });

    return (
        <Frame
            nav={nav}
            snapshot={snapshot}
            now={now}
            message={message}
            shell={keys.shell}
            file={props.file}
            width={width}
            height={height}
            list={list}
            onPick={(key) => {
                atoms.keyPressed();
                apply(Action.Pick({ key }));
            }}
        />
    );
};
