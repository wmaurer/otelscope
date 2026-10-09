import { useAtomValue } from "@effect/atom-react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { Array as Arr, Option } from "effect";
import { useRef, useState } from "react";

import { dispatch } from "../keys/Dispatch.ts";
import { initialShell, modeOf, ShellEffect, stepShell } from "../keys/Shell.ts";
import { overlayContent, overlayExtent } from "../model/overlays.ts";
import { Frame } from "./Frame.tsx";

import type { Atoms } from "../bridge/Atoms.ts";
import type { Shell } from "../keys/Shell.ts";
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
    const { width, height } = useTerminalDimensions();
    const [shell, setShell] = useState<Shell>(initialShell);
    // Two keys can arrive before React renders again, and the second must see what the first opened.
    const current = useRef<Shell>(initialShell);

    useKeyboard((key) => {
        atoms.keyPressed();
        const registry = atoms.registry;
        const before = registry.get(atoms.nav);
        const action = dispatch(modeOf(current.current), before, key);
        if (Option.isNone(action)) {
            return;
        }
        const latest = registry.get(atoms.snapshot);
        const open = current.current;
        const extent =
            open._tag === "Overlay"
                ? overlayExtent(overlayContent(open.kind, before, latest), { width, height })
                : { total: 0, viewport: 0 };
        const step = stepShell(open, before, latest, extent, action.value);
        current.current = step.shell;
        setShell(step.shell);
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
    });

    return (
        <Frame
            nav={nav}
            snapshot={snapshot}
            now={now}
            message={message}
            shell={shell}
            file={props.file}
            width={width}
            height={height}
        />
    );
};
