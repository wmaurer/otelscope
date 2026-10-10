import { TextAttributes } from "@opentui/core";
import { Array as Arr, pipe } from "effect";

import { theme } from "./theme.ts";

import type { Frame, OverlayContent } from "../model/overlays.ts";
import type { Line } from "../model/Role.ts";
import type { ReactNode } from "react";

export const LineText = (props: { readonly line: Line }): ReactNode => (
    <text wrapMode="none" height={1}>
        {Arr.map(props.line, (chunk, i) => (
            <span
                key={i}
                fg={theme[chunk.role]}
                bg={chunk.bg === undefined ? "transparent" : theme[chunk.bg]}
                attributes={chunk.bold === true ? TextAttributes.BOLD : TextAttributes.NONE}
            >
                {chunk.text}
            </span>
        ))}
    </text>
);

export const Placeholder = (props: { readonly lines: ReadonlyArray<Line> }): ReactNode => (
    <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
        {Arr.map(props.lines, (line, i) => (
            <LineText key={i} line={line} />
        ))}
    </box>
);

export const Overlay = (props: {
    readonly content: OverlayContent;
    readonly frame: Frame;
    readonly scroll: number;
}): ReactNode => (
    <box
        position="absolute"
        left={props.frame.left}
        top={props.frame.top}
        width={props.frame.width}
        height={props.frame.height}
        zIndex={10}
        flexDirection="column"
        border
        borderColor={theme.faint}
        backgroundColor={theme.overlayBg}
        title={` ${props.content.title} `}
        titleColor={theme.text}
        paddingLeft={1}
        paddingRight={1}
    >
        {pipe(
            props.content.lines,
            Arr.drop(props.scroll),
            Arr.take(props.frame.viewport),
            Arr.map((line, i) => <LineText key={props.scroll + i} line={line} />),
        )}
    </box>
);
