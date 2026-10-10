import { Array as Arr, Number as Num, Option } from "effect";

import { moveRows } from "../keys/Action.ts";
import { problemText, shownOf } from "../model/bodyModel.ts";
import { clampedView, SIDEWAYS } from "../model/bodyRows.ts";
import { currentOf } from "../model/bodySearch.ts";
import { size } from "../model/format.ts";
import { firstAtOrAfter, nextStop } from "../model/stops.ts";
import { replace, top, update } from "./Nav.ts";
import { Screen } from "./Screen.ts";
import { said, ShellEffect, stepTo } from "./ScreenStep.ts";

import type { BodyAction, Dir } from "../keys/Action.ts";
import type { Nav } from "./Nav.ts";
import type { BodyView, ScreenOf } from "./Screen.ts";
import type { BodyContext, ScreenStep } from "./ScreenStep.ts";

/** Terminals cap OSC 52, and some truncate silently. */
export const COPY_LIMIT = 100_000;

export const EDIT_WARNING = "editing changes the stored body (bodies are shared by hash)";

const CONTEXT_ROWS = 2;

const signed = (dir: Dir, n: number): number => (dir === "next" ? n : -n);

/**
 * Makes the match at `offset` current, scrolling only when it is out of sight: its row goes `CONTEXT_ROWS` from the
 * top, and with wrapping off the columns move only when the match is outside them.
 */
const reveal = (view: BodyView, context: BodyContext, offset: number): BodyView => {
    const { rows, viewport, width } = context;
    const { top: topRow, left, maxTop, maxLeft } = clampedView(view, rows, viewport, width);
    const row = rows.rowAt(offset);
    const margin = Math.min(CONTEXT_ROWS, Math.floor((viewport - 1) / 2));
    const topLine =
        row >= topRow && row < topRow + viewport ? topRow : Num.clamp(row - margin, { minimum: 0, maximum: maxTop });
    const column = offset - (rows.start[row] ?? 0);
    const length = shownOf(context.model.content).matches.length;
    const leftCol =
        view.wrap || (column >= left && column + length <= left + width)
            ? left
            : Num.clamp(column - SIDEWAYS, { minimum: 0, maximum: maxLeft });
    return { ...view, topLine, leftCol, current: Option.some(offset) };
};

export const stepBody = (nav: Nav, screen: ScreenOf<"Body">, context: BodyContext, action: BodyAction): ScreenStep => {
    const { model, rows, viewport, width } = context;
    const { view } = screen;
    const { doc, matches } = shownOf(model.content);
    const { top: topRow, left, maxTop, maxLeft } = clampedView(view, rows, viewport, width);
    const set = (next: BodyView): ScreenStep => stepTo(update(nav, "Body", () => next));
    const scrollTo = (line: number): ScreenStep =>
        set({ ...view, topLine: Num.clamp(line, { minimum: 0, maximum: maxTop }) });
    switch (action._tag) {
        case "Move":
            return scrollTo(topRow + signed(action.dir, moveRows(action.by, viewport)));
        case "Jump":
            return scrollTo(action.to === "start" ? 0 : maxTop);
        case "ScrollBody":
            return scrollTo(topRow + action.rows);
        case "Sideways":
            return view.wrap
                ? stepTo(nav)
                : set({
                      ...view,
                      leftCol: Num.clamp(left + signed(action.dir, SIDEWAYS), { minimum: 0, maximum: maxLeft }),
                  });
        case "CycleBody": {
            const { refs } = model;
            if (refs.length < 2) {
                return stepTo(nav);
            }
            const at = Option.getOrElse(
                Arr.findFirstIndex(refs, (ref) => ref.prefix === screen.prefix),
                () => 0,
            );
            const next = refs[(at + signed(action.dir, 1) + refs.length) % refs.length] ?? model.ref;
            return stepTo(
                replace(
                    nav,
                    Screen.Body({
                        ...screen,
                        prefix: next.prefix,
                        view: { ...view, topLine: 0, leftCol: 0, current: Option.none() },
                    }),
                ),
            );
        }
        case "ToggleRaw":
            return set({ ...view, raw: !view.raw, topLine: 0, leftCol: 0, current: Option.none() });
        case "ToggleWrap":
            return set({ ...view, wrap: !view.wrap, topLine: 0, leftCol: 0 });
        case "NextMatch": {
            const topStart = rows.start[topRow] ?? 0;
            const anchor = Option.getOrElse(
                Option.filter(currentOf(matches, view.current), (at) => {
                    const row = rows.rowAt(at);
                    return row >= topRow && row < topRow + viewport;
                }),
                // Between the top row's start and the offset before it: `n` finds the first match at or after the
                // top row, `N` the last one before it.
                () => topStart - 0.5,
            );
            return Option.match(nextStop(matches.starts, anchor, action.dir), {
                onNone: () => said(nav, "no matches"),
                onSome: (offset) => set(reveal(view, context, offset)),
            });
        }
        case "Copy": {
            if (model.content._tag === "Loading") {
                return stepTo(nav);
            }
            const bytes = Buffer.byteLength(doc.text);
            return bytes > COPY_LIMIT
                ? said(nav, `too large to copy (${size(bytes)}), use e`)
                : { nav, effects: [ShellEffect.Copy({ text: doc.text, done: `copied ${size(bytes)}` })] };
        }
        case "OpenEditor":
            switch (model.content._tag) {
                case "Loading":
                    return stepTo(nav);
                case "Preview":
                    return said(nav, problemText(model.ref, model.content.problem));
                case "Stored":
                    return {
                        nav,
                        effects: [
                            ShellEffect.Say({ text: EDIT_WARNING }),
                            ShellEffect.Edit({
                                target: { file: model.content.text.path, line: Option.none(), col: Option.none() },
                            }),
                        ],
                    };
            }
    }
};

/** `⏎` in the Body's `/` input: the first match at or after the top row, else the first one. */
export const seekFirstMatch = (nav: Nav, context: BodyContext): Nav => {
    const screen = top(nav);
    const { matches } = shownOf(context.model.content);
    if (screen._tag !== "Body" || matches.search !== screen.view.search) {
        return nav;
    }
    const { top: topRow } = clampedView(screen.view, context.rows, context.viewport, context.width);
    return Option.match(
        Option.orElse(firstAtOrAfter(matches.starts, context.rows.start[topRow] ?? 0), () => Arr.head(matches.starts)),
        {
            onNone: () => nav,
            onSome: (offset) => update(nav, "Body", (view) => reveal(view, context, offset)),
        },
    );
};
