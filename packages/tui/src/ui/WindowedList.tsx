import { Option } from "effect";
import { useRef, useState } from "react";

import { deriveScroll, initialScroll, visibleOffset, wheeled } from "../model/scroll.ts";
import { LineText } from "./Chrome.tsx";

import type { Line } from "../model/Role.ts";
import type { Scroll, Wheel } from "../model/scroll.ts";
import type { MouseEvent } from "@opentui/core";
import type { ReactNode } from "react";

export const WHEEL_ROWS = 3;

interface WindowedListProps {
    readonly size: number;
    readonly selected: number;
    readonly keyAt: (index: number) => string;
    readonly line: (index: number, selected: boolean) => Line;
    readonly height: number;
    readonly onPick: (key: string) => void;
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
                onMouseDown={() => {
                    pressed.current = key;
                }}
                onMouseUp={() => {
                    if (pressed.current === key) {
                        props.onPick(key);
                    }
                    pressed.current = undefined;
                }}
            >
                <LineText line={props.line(i, i === selected)} />
            </box>
        );
    }
    return (
        <box flexDirection="column" height={height} onMouseScroll={onScroll}>
            {rows}
        </box>
    );
};
