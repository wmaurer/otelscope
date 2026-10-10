import { Renderable, RGBA } from "@opentui/core";
import { extend } from "@opentui/react";
import { Array as Arr } from "effect";

import { theme } from "./theme.ts";

import type { Role } from "../model/Role.ts";
import type { Segment } from "../model/waterfall.ts";
import type { OptimizedBuffer, RenderableOptions, RenderContext } from "@opentui/core";

export interface CellRowOptions extends RenderableOptions<CellRowRenderable> {
    readonly segments?: ReadonlyArray<Segment>;
    readonly background?: Role | undefined;
}

const colours = new Map(Arr.map(Object.entries(theme), ([role, hex]) => [role, RGBA.fromHex(hex)] as const));

const colourOf = (role: Role): RGBA => colours.get(role) ?? RGBA.fromHex(theme.text);

/**
 * One row of cells drawn straight into the buffer, run by run: the waterfall's bars and axis, which 06 wants drawn per
 * cell rather than as text spans.
 */
export class CellRowRenderable extends Renderable {
    private drawn: ReadonlyArray<Segment>;
    private fill: Role | undefined;

    constructor(ctx: RenderContext, options: CellRowOptions) {
        super(ctx, { height: 1, flexShrink: 0, ...options });
        this.drawn = options.segments ?? [];
        this.fill = options.background;
    }

    set segments(value: ReadonlyArray<Segment>) {
        if (value !== this.drawn) {
            this.drawn = value;
            this.requestRender();
        }
    }

    set background(value: Role | undefined) {
        if (value !== this.fill) {
            this.fill = value;
            this.requestRender();
        }
    }

    protected override renderSelf(buffer: OptimizedBuffer): void {
        const background = this.fill === undefined ? undefined : colourOf(this.fill);
        if (background !== undefined) {
            buffer.fillRect(this.x, this.y, this.width, 1, background);
        }
        for (const segment of this.drawn) {
            const room = this.width - segment.x;
            if (room > 0) {
                buffer.drawText(
                    segment.text.slice(0, room),
                    this.x + segment.x,
                    this.y,
                    colourOf(segment.role),
                    background,
                );
            }
        }
    }
}

declare module "@opentui/react" {
    interface OpenTUIComponents {
        cellRow: typeof CellRowRenderable;
    }
}

extend({ cellRow: CellRowRenderable });
