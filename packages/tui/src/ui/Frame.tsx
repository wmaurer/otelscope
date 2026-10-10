import { Option } from "effect";

import { hintFacts, hintLine } from "../keys/Hints.ts";
import { modeOf } from "../keys/Shell.ts";
import { breadcrumb, segments } from "../model/breadcrumb.ts";
import { listFrame } from "../model/listFrame.ts";
import { overlayContent, overlayFrame } from "../model/overlays.ts";
import { placeholderLines } from "../model/placeholder.ts";
import { statusBar } from "../model/statusBar.ts";
import { top } from "../nav/Nav.ts";
import { presence } from "../nav/Resolve.ts";
import { LineText, Overlay, Placeholder } from "./Chrome.tsx";
import { ListBody } from "./ListBody.tsx";

import type { Snapshot } from "../data/Snapshot.ts";
import type { Shell } from "../keys/Shell.ts";
import type { ScreenList } from "../model/screenList.ts";
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
    readonly list: ScreenList;
    readonly onPick: (key: string) => void;
}

/** The breadcrumb, the table header and the status bar. */
const LIST_CHROME_ROWS = 3;

export const listRows = (height: number): number => Math.max(1, height - LIST_CHROME_ROWS);

export const Frame = (props: FrameProps): ReactNode => {
    const { nav, snapshot, now, shell, width, height } = props;
    const screen = top(nav);
    const placeholder = placeholderLines(presence(screen, snapshot));
    const list = Option.isSome(placeholder)
        ? Option.none()
        : listFrame(screen, props.list, { snapshot, now, file: props.file, width });
    const hints = hintLine(modeOf(shell), nav, hintFacts(nav, snapshot));
    const bar = statusBar(
        {
            hints,
            message: props.message,
            query: Option.flatMap(list, (frame) => frame.query),
            newRows: Option.flatMap(list, (frame) => frame.newRows),
            snapshot,
            file: props.file,
            now,
        },
        width,
    );
    const overlay =
        shell._tag === "Overlay"
            ? Option.some({ scroll: shell.scroll, content: overlayContent(shell.kind, nav, snapshot) })
            : Option.none();
    return (
        <box flexDirection="column" width={width} height={height}>
            <LineText line={breadcrumb(segments(nav, snapshot, now), width)} />
            {Option.match(placeholder, {
                onSome: (lines) => <Placeholder lines={lines} />,
                onNone: () =>
                    Option.match(list, {
                        onNone: () => <box flexGrow={1} />,
                        onSome: ({ body }) => (
                            <ListBody
                                key={nav.stack.length}
                                body={body}
                                rows={listRows(height)}
                                onPick={props.onPick}
                            />
                        ),
                    }),
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
