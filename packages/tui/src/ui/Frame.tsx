import { Option } from "effect";

import { Action } from "../keys/Action.ts";
import { hintFacts, hintLine } from "../keys/Hints.ts";
import { modeOf } from "../keys/Shell.ts";
import { bodyFrame } from "../model/bodyFrame.ts";
import { breadcrumb, segments } from "../model/breadcrumb.ts";
import { listFrame } from "../model/listFrame.ts";
import { overlayContent, overlayFrame } from "../model/overlays.ts";
import { noBodyLines, placeholderLines } from "../model/placeholder.ts";
import { inputBar, statusBar } from "../model/statusBar.ts";
import { traceFrame } from "../model/traceFrame.ts";
import { top } from "../nav/Nav.ts";
import { activeQuery } from "../nav/Query.ts";
import { presence } from "../nav/Resolve.ts";
import { BodyPager } from "./BodyPager.tsx";
import { LineText, Overlay, Placeholder } from "./Chrome.tsx";
import { ListBody } from "./ListBody.tsx";
import { TraceBody } from "./TraceBody.tsx";

import type { Snapshot } from "../data/Snapshot.ts";
import type { ScreenAction } from "../keys/Action.ts";
import type { Shell } from "../keys/Shell.ts";
import type { BodyModel } from "../model/bodyModel.ts";
import type { Panes } from "../model/panes.ts";
import type { ScreenList } from "../model/screenList.ts";
import type { BodyStats } from "../model/traceFrame.ts";
import type { TraceModel } from "../model/traceModel.ts";
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
    readonly trace: Option.Option<TraceModel>;
    readonly panes: Panes;
    readonly bodyStats: BodyStats;
    readonly body: Option.Option<BodyModel>;
    readonly onAction: (action: ScreenAction) => void;
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
    const trace =
        screen._tag === "Trace" && Option.isNone(placeholder)
            ? Option.map(props.trace, (model) =>
                  traceFrame(model, screen.view, {
                      size: { width, height },
                      panes: props.panes,
                      now,
                      snapshot,
                      bodyStats: props.bodyStats,
                  }),
              )
            : Option.none();
    const body =
        screen._tag === "Body" && Option.isNone(placeholder)
            ? Option.map(props.body, (model) =>
                  bodyFrame(model, screen.view, { size: { width, height }, file: props.file }),
              )
            : Option.none();
    const counted = Option.firstSomeOf([
        Option.map(list, (frame) => frame.count),
        Option.map(trace, (frame) => frame.count),
        Option.map(body, (frame) => frame.count),
    ]);
    const bar =
        shell._tag === "Input"
            ? inputBar(
                  activeQuery(nav),
                  shell.cursor,
                  Option.getOrElse(counted, () => ""),
                  width,
              )
            : statusBar(
                  {
                      hints: hintLine(modeOf(shell), nav, hintFacts(props.trace)),
                      message: props.message,
                      query: Option.firstSomeOf([
                          Option.flatMap(list, (frame) => frame.query),
                          Option.flatMap(trace, (frame) => frame.query),
                          Option.flatMap(body, (frame) => frame.query),
                      ]),
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
                    Option.getOrElse(
                        Option.firstSomeOf([
                            Option.map(list, (frame) => (
                                <ListBody
                                    key={nav.stack.length}
                                    body={frame.body}
                                    rows={listRows(height)}
                                    onPick={(key) => props.onAction(Action.Pick({ key }))}
                                />
                            )),
                            Option.map(trace, (frame) => (
                                <TraceBody
                                    key={`${nav.stack.length}:${screen._tag === "Trace" ? screen.traceId : ""}`}
                                    frame={frame}
                                    size={{ width, height }}
                                    onAction={props.onAction}
                                />
                            )),
                            Option.map(body, (frame) => <BodyPager frame={frame} onAction={props.onAction} />),
                        ]),
                        () =>
                            screen._tag === "Body" ? (
                                <Placeholder lines={noBodyLines(screen.prefix)} />
                            ) : (
                                <box flexGrow={1} />
                            ),
                    ),
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
