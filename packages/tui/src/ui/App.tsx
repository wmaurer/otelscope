import { useAtomValue } from "@effect/atom-react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { Array as Arr, Option } from "effect";
import { useRef, useState } from "react";

import { dispatch } from "../keys/Dispatch.ts";
import { initialKeyState, modeOf, stepShell } from "../keys/Shell.ts";
import { bodyContext } from "../model/bodyFrame.ts";
import { overlayContent, overlayExtent } from "../model/overlays.ts";
import { traceContext } from "../model/traceFrame.ts";
import { top } from "../nav/Nav.ts";
import { ShellEffect } from "../nav/ScreenStep.ts";
import { Frame, listRows } from "./Frame.tsx";

import type { Atoms } from "../bridge/Atoms.ts";
import type { EditTarget } from "../editor.ts";
import type { Action } from "../keys/Action.ts";
import type { KeyState } from "../keys/Shell.ts";
import type { ReactNode } from "react";

export interface AppProps {
    readonly atoms: (typeof Atoms)["Service"];
    /** Absolute. */
    readonly file: string;
    readonly onQuit: () => void;
    readonly onSuspend: () => void;
    readonly onEdit: (target: EditTarget) => void;
    /** Whether the terminal took the text. */
    readonly onCopy: (text: string) => boolean;
}

export const NO_COPY = "the terminal did not accept the copy (OSC 52)";

export const App = (props: AppProps): ReactNode => {
    const { atoms } = props;
    const nav = useAtomValue(atoms.nav);
    const snapshot = useAtomValue(atoms.snapshot);
    const now = useAtomValue(atoms.now);
    const message = useAtomValue(atoms.message);
    const list = useAtomValue(atoms.list);
    const trace = useAtomValue(atoms.trace);
    const panes = useAtomValue(atoms.panes);
    const bodyStats = useAtomValue(atoms.bodyStats);
    const body = useAtomValue(atoms.bodyModel);
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
                trace: Option.map(registry.get(atoms.trace), (model) =>
                    traceContext(model, {
                        size: { width, height },
                        panes: registry.get(atoms.panes),
                        now: registry.get(atoms.now),
                        snapshot: latest,
                        bodyStats: registry.get(atoms.bodyStats),
                    }),
                ),
                body: Option.flatMap(registry.get(atoms.bodyModel), (model) => {
                    const screen = top(before);
                    return screen._tag === "Body"
                        ? Option.some(bodyContext(model, screen.view, { width, height }))
                        : Option.none();
                }),
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
                SetPanes: ({ panes }) => registry.set(atoms.panes, panes),
                Edit: ({ target }) => props.onEdit(target),
                Copy: ({ text, done }) => registry.set(atoms.message, Option.some(props.onCopy(text) ? done : NO_COPY)),
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
            trace={trace}
            panes={panes}
            bodyStats={bodyStats}
            body={body}
            onAction={(action) => {
                atoms.keyPressed();
                apply(action);
            }}
        />
    );
};
