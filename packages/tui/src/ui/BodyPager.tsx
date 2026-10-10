import { Array as Arr, Option } from "effect";

import { Action } from "../keys/Action.ts";
import { LineText } from "./Chrome.tsx";

import type { ScreenAction } from "../keys/Action.ts";
import type { BodyFrame } from "../model/bodyFrame.ts";
import type { MouseEvent } from "@opentui/core";
import type { ReactNode } from "react";

const WHEEL_ROWS = 3;

/** The header, the tab row and the notice when there are any, and the visible rows. */
export const BodyPager = (props: {
    readonly frame: BodyFrame;
    readonly onAction: (action: ScreenAction) => void;
}): ReactNode => {
    const { frame } = props;
    return (
        <box
            flexDirection="column"
            flexGrow={1}
            onMouseScroll={(event: MouseEvent) => {
                const direction = event.scroll?.direction;
                if (direction === "up" || direction === "down") {
                    props.onAction(Action.ScrollBody({ rows: direction === "down" ? WHEEL_ROWS : -WHEEL_ROWS }));
                }
            }}
        >
            <LineText line={frame.header} />
            {Option.match(frame.tabs, { onNone: () => null, onSome: (line) => <LineText line={line} /> })}
            {Option.match(frame.notice, { onNone: () => null, onSome: (line) => <LineText line={line} /> })}
            {Arr.map(frame.rows, (line, i) => (
                <LineText key={i} line={line} />
            ))}
        </box>
    );
};
