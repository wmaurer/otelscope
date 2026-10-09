import { Option } from "effect";

import { hintFacts, hintLine } from "../keys/Hints.ts";
import { modeOf } from "../keys/Shell.ts";
import { breadcrumb, segments } from "../model/breadcrumb.ts";
import { overlayContent, overlayFrame } from "../model/overlays.ts";
import { placeholderLines } from "../model/placeholder.ts";
import { statusBar } from "../model/statusBar.ts";
import { top } from "../nav/Nav.ts";
import { presence } from "../nav/Resolve.ts";
import { LineText, Overlay, Placeholder } from "./Chrome.tsx";

import type { Snapshot } from "../data/Snapshot.ts";
import type { Shell } from "../keys/Shell.ts";
import type { Nav } from "../nav/Nav.ts";
import type { ReactNode } from "react";

export interface FrameProps {
    readonly nav: Nav;
    readonly snapshot: Snapshot;
    readonly now: number;
    readonly message: Option.Option<string>;
    readonly shell: Shell;
    /** Absolute. */
    readonly file: string;
    readonly width: number;
    readonly height: number;
}

export const Frame = (props: FrameProps): ReactNode => {
    const { nav, snapshot, now, shell, width, height } = props;
    const hints = hintLine(modeOf(shell), nav, hintFacts(nav, snapshot));
    const bar = statusBar(
        {
            hints,
            message: props.message,
            query: Option.none(),
            newRows: Option.none(),
            snapshot,
            file: props.file,
            now,
        },
        width,
    );
    const placeholder = placeholderLines(presence(top(nav), snapshot));
    const overlay =
        shell._tag === "Overlay"
            ? Option.some({ scroll: shell.scroll, content: overlayContent(shell.kind, nav, snapshot) })
            : Option.none();
    return (
        <box flexDirection="column" width={width} height={height}>
            <LineText line={breadcrumb(segments(nav, snapshot, now), width)} />
            {Option.match(placeholder, {
                onNone: () => <box flexGrow={1} />,
                onSome: (lines) => <Placeholder lines={lines} />,
            })}
            <LineText line={bar} />
            {Option.match(overlay, {
                onNone: () => null,
                onSome: ({ scroll, content }) => (
                    <Overlay
                        content={content}
                        frame={overlayFrame({ width, height }, content.lines.length)}
                        scroll={scroll}
                    />
                ),
            })}
        </box>
    );
};
