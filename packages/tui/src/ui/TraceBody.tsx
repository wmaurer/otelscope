import { Array as Arr, Option, pipe } from "effect";

import { Action, ClickTarget } from "../keys/Action.ts";
import { splitAt } from "../model/traceLayout.ts";
import { LineText } from "./Chrome.tsx";
import { theme } from "./theme.ts";
import { WindowedList } from "./WindowedList.tsx";
import "./CellRow.ts";

import type { ScreenAction } from "../keys/Action.ts";
import type { DetailsPaneFrame, LogsPaneFrame, TraceFrame, TreePaneFrame } from "../model/traceFrame.ts";
import type { Rect } from "../model/traceLayout.ts";
import type { MouseEvent } from "@opentui/core";
import type { ReactNode } from "react";

const WHEEL_ROWS = 3;

type OnAction = (action: ScreenAction) => void;

/** A bordered pane titled `1 Tree` and so on; a click anywhere in it focuses it. */
const Pane = (props: {
    readonly title: string;
    readonly rect: Rect;
    readonly focused: boolean;
    readonly onPress: () => void;
    readonly onScroll?: (event: MouseEvent) => void;
    readonly children: ReactNode;
}): ReactNode => (
    <box
        width={props.rect.width}
        height={props.rect.height}
        flexDirection="column"
        flexShrink={0}
        border
        borderColor={props.focused ? theme.focusBorder : theme.faint}
        title={` ${props.title} `}
        titleColor={props.focused ? theme.focusBorder : theme.muted}
        onMouseUp={props.onPress}
        {...(props.onScroll === undefined ? {} : { onMouseScroll: props.onScroll })}
    >
        {props.children}
    </box>
);

const TreePane = (props: {
    readonly pane: TreePaneFrame;
    readonly rect: Rect;
    readonly rows: number;
    readonly barWidth: number;
    readonly focused: boolean;
    readonly onAction: OnAction;
}): ReactNode => {
    const { pane, rect } = props;
    return (
        <Pane
            title={pane.title}
            rect={rect}
            focused={props.focused}
            onPress={() => props.onAction(Action.Click({ pane: "tree", target: ClickTarget.Pane() }))}
        >
            <cellRow segments={pane.axis} width={rect.width - 2} />
            <WindowedList
                size={pane.size}
                selected={pane.selected}
                keyAt={pane.keyAt}
                height={props.rows}
                row={(index, selected) => (
                    <box flexDirection="row" height={1}>
                        <LineText line={pane.left(index, selected)} />
                        <cellRow
                            segments={pane.bar(index)}
                            width={props.barWidth}
                            background={selected ? "selectionBg" : undefined}
                        />
                    </box>
                )}
                onPick={(key, x) =>
                    props.onAction(
                        Action.Click({
                            pane: "tree",
                            target:
                                pane.hit(key, x - rect.x - 1) === "mark"
                                    ? ClickTarget.Mark({ key })
                                    : ClickTarget.Row({ key }),
                        }),
                    )
                }
            />
        </Pane>
    );
};

const DetailsPane = (props: {
    readonly pane: DetailsPaneFrame;
    readonly rect: Rect;
    readonly rows: number;
    readonly focused: boolean;
    readonly onAction: OnAction;
}): ReactNode => {
    const { pane } = props;
    return (
        <Pane
            title={pane.title}
            rect={props.rect}
            focused={props.focused}
            onPress={() => props.onAction(Action.Click({ pane: "details", target: ClickTarget.Pane() }))}
            onScroll={(event) => {
                const direction = event.scroll?.direction;
                if (direction === "up" || direction === "down") {
                    props.onAction(Action.ScrollDetails({ rows: direction === "down" ? WHEEL_ROWS : -WHEEL_ROWS }));
                }
            }}
        >
            {pipe(
                pane.rows,
                Arr.drop(pane.top),
                Arr.take(props.rows),
                Arr.map((row, i) =>
                    Option.match(row.body, {
                        onNone: () => <LineText key={pane.top + i} line={row.line} />,
                        onSome: (prefix) => (
                            <box
                                key={pane.top + i}
                                height={1}
                                onMouseUp={(event: MouseEvent) => {
                                    event.stopPropagation();
                                    props.onAction(
                                        Action.Click({ pane: "details", target: ClickTarget.Body({ prefix }) }),
                                    );
                                }}
                            >
                                <LineText line={row.line} />
                            </box>
                        ),
                    }),
                ),
            )}
        </Pane>
    );
};

const LogsPane = (props: {
    readonly pane: LogsPaneFrame;
    readonly rect: Rect;
    readonly rows: number;
    readonly focused: boolean;
    readonly onAction: OnAction;
}): ReactNode => {
    const { pane } = props;
    return (
        <Pane
            title={pane.title}
            rect={props.rect}
            focused={props.focused}
            onPress={() => props.onAction(Action.Click({ pane: "logs", target: ClickTarget.Pane() }))}
        >
            <WindowedList
                size={pane.size}
                selected={pane.selected}
                keyAt={pane.keyAt}
                height={props.rows}
                row={(index, selected) => <LineText line={pane.line(index, selected)} />}
                onPick={(key) =>
                    props.onAction(Action.Click({ pane: "logs", target: ClickTarget.Row({ key: pane.logOf(key) }) }))
                }
            />
        </Pane>
    );
};

/** The trace header line and the three panes, wide or stacked, with the divider grip between tree and details. */
export const TraceBody = (props: {
    readonly frame: TraceFrame;
    readonly size: { readonly width: number; readonly height: number };
    readonly onAction: OnAction;
}): ReactNode => {
    const { frame, onAction } = props;
    const { layout, focus } = frame;
    const tree = (
        <TreePane
            pane={frame.tree}
            rect={layout.tree}
            rows={layout.treeRows}
            barWidth={layout.barWidth}
            focused={focus === "tree"}
            onAction={onAction}
        />
    );
    const details = (
        <DetailsPane
            pane={frame.details}
            rect={layout.details}
            rows={layout.detailsRows}
            focused={focus === "details"}
            onAction={onAction}
        />
    );
    const logs = (
        <LogsPane
            pane={frame.logs}
            rect={layout.logs}
            rows={layout.logsRows}
            focused={focus === "logs"}
            onAction={onAction}
        />
    );
    return (
        <box flexDirection="column" flexGrow={1}>
            <LineText line={frame.header} />
            <box flexDirection="column" height={layout.body.height}>
                {layout.mode === "wide" ? (
                    <>
                        <box flexDirection="row" height={layout.tree.height}>
                            {tree}
                            {details}
                        </box>
                        {logs}
                    </>
                ) : (
                    <>
                        {tree}
                        <box flexDirection="row" height={layout.details.height}>
                            {details}
                            {logs}
                        </box>
                    </>
                )}
                <box
                    position="absolute"
                    left={layout.grip.x}
                    top={layout.grip.y}
                    width={layout.grip.width}
                    height={layout.grip.height}
                    zIndex={5}
                    onMouseDrag={(event: MouseEvent) =>
                        onAction(Action.SetSplit({ percent: splitAt(layout, props.size, event.x, event.y) }))
                    }
                />
            </box>
        </box>
    );
};
