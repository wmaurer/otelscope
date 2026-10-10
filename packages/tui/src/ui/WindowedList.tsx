import { Option } from "effect";
import { useRef, useState } from "react";

import { deriveScroll, initialScroll, visibleOffset, wheeled } from "../model/scroll.ts";

import type { Scroll, Wheel } from "../model/scroll.ts";
import type { MouseEvent } from "@opentui/core";
import type { ReactNode } from "react";

const WHEEL_ROWS = 3;

interface WindowedListProps {
    readonly size: number;
    readonly selected: number;
    readonly keyAt: (index: number) => string;
    readonly row: (index: number, selected: boolean) => ReactNode;
    readonly height: number;
    /** A press and release on one row; `x` is the release's screen column. */
    readonly onPick: (key: string, x: number) => void;
}

export const WindowedList = (props: WindowedListProps): ReactNode => {
    const { size, selected, height } = props;
    const [scroll, setScroll] = useState<Scroll>(initialScroll);
    const pressed = useRef<string | undefined>(undefined);
    const [wheel, setWheel] = useState<Option.Option<Wheel>>(Option.none());
    const derived = deriveScroll(scroll, {
        count: size,
        viewport: height,
        selectedIndex: selected,
        selectedKey: selected < 0 ? "" : props.keyAt(selected),
    });
    if (derived.offset !== scroll.offset || derived.key !== scroll.key || derived.index !== scroll.index) {
        setScroll(derived);
    }
    const offset = visibleOffset(derived, wheel);
    const onScroll = (event: MouseEvent) => {
        event.stopPropagation();
        const direction = event.scroll?.direction;
        if (direction === "up" || direction === "down") {
            setWheel(
                Option.some(wheeled(offset, derived, direction === "down" ? WHEEL_ROWS : -WHEEL_ROWS, size, height)),
            );
        }
    };
    const end = Math.min(size, offset + height);
    const rows: Array<ReactNode> = [];
    for (let i = offset; i < end; i++) {
        const key = props.keyAt(i);
        rows[rows.length] = (
            <box
                key={key}
                height={1}
                onMouseDown={(event: MouseEvent) => {
                    event.stopPropagation();
                    pressed.current = key;
                }}
                onMouseUp={(event: MouseEvent) => {
                    event.stopPropagation();
                    if (pressed.current === key) {
                        props.onPick(key, event.x);
                    }
                    pressed.current = undefined;
                }}
            >
                {props.row(i, i === selected)}
            </box>
        );
    }
    return (
        <box flexDirection="column" height={height} onMouseScroll={onScroll}>
            {rows}
        </box>
    );
};
