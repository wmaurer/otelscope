import { Array as Arr } from "effect";

import { helpSections } from "../keys/Help.ts";
import { top } from "../nav/Nav.ts";
import { count } from "./format.ts";
import { chunk } from "./Role.ts";
import { cells } from "./text.ts";

import type { BadLines } from "../data/Snapshot.ts";
import type { Snapshot } from "../data/Snapshot.ts";
import type { HelpSection } from "../keys/Help.ts";
import type { Extent } from "../keys/Shell.ts";
import type { Nav } from "../nav/Nav.ts";
import type { Line } from "./Role.ts";

export interface OverlayContent {
    readonly title: string;
    readonly lines: ReadonlyArray<Line>;
}

export const MOUSE_HELP =
    "Mouse: click selects, click again opens · wheel scrolls the pane under it · drag the divider";

export const helpContent = (screen: string, sections: ReadonlyArray<HelpSection>): OverlayContent => {
    const keyWidth = Arr.reduce(
        Arr.flatMap(sections, (section) => section.rows),
        0,
        (max, row) => Math.max(max, cells(row.keys)),
    );
    const blocks = Arr.map(sections, (section): ReadonlyArray<Line> => [
        section.focused
            ? [chunk("▸ ", "accent"), chunk(section.title, "text", true), chunk("  focused", "muted")]
            : [chunk(section.title, "text", true)],
        ...Arr.map(section.rows, (row): Line => [
            chunk(`  ${row.keys.padEnd(keyWidth)}  `, "accent"),
            chunk(row.label, "text"),
        ]),
    ]);
    return {
        title: `Help · ${screen}`,
        lines: [
            ...Arr.flatMap(blocks, (block, i) => (i > 0 ? [[], ...block] : block)),
            [],
            [chunk(MOUSE_HELP, "muted")],
        ],
    };
};

export const badLinesContent = (badLines: BadLines): OverlayContent => {
    const title = Arr.join(
        [
            "Bad lines",
            ...(badLines.malformed > 0 ? [`${count(badLines.malformed)} malformed`] : []),
            ...(badLines.legacy > 0 ? [`${count(badLines.legacy)} legacy (not sampled)`] : []),
        ],
        " · ",
    );
    const samples = Arr.flatMap(badLines.samples, (sample): ReadonlyArray<Line> => [
        [chunk(`line ${count(sample.line)} · byte ${count(sample.offset)} · ${sample.issue}`, "text")],
        [chunk(`  ${sample.text}`, "muted")],
    ]);
    return {
        title,
        lines: Arr.isReadonlyArrayNonEmpty(samples) ? samples : [[chunk("legacy lines are not sampled", "muted")]],
    };
};

export const overlayContent = (kind: "help" | "badLines", nav: Nav, snapshot: Snapshot): OverlayContent =>
    kind === "help" ? helpContent(top(nav)._tag, helpSections(nav)) : badLinesContent(snapshot.badLines);

export interface Frame {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly viewport: number;
}

export const overlayFrame = (terminal: { readonly width: number; readonly height: number }, lines: number): Frame => {
    const width = Math.min(terminal.width, Math.max(40, Math.floor(terminal.width * 0.8)));
    const height = Math.min(Math.max(3, Math.floor(terminal.height * 0.8)), lines + 2);
    return {
        left: Math.floor((terminal.width - width) / 2),
        top: Math.floor((terminal.height - height) / 2),
        width,
        height,
        viewport: Math.max(0, height - 2),
    };
};

export const overlayExtent = (
    content: OverlayContent,
    terminal: { readonly width: number; readonly height: number },
): Extent => ({ total: content.lines.length, viewport: overlayFrame(terminal, content.lines.length).viewport });
