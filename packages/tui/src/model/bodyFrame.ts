import { Array as Arr, Option } from "effect";

import { problemText, shownOf } from "./bodyModel.ts";
import { clampedView, rowLine, rowsOf } from "./bodyRows.ts";
import { matchText } from "./bodySearch.ts";
import { basename, count, size } from "./format.ts";
import { chunk } from "./Role.ts";
import { cutLine } from "./text.ts";

import type { BodyView } from "../nav/Screen.ts";
import type { BodyContext } from "../nav/ScreenStep.ts";
import type { BodyModel } from "./bodyModel.ts";
import type { Line } from "./Role.ts";

export interface BodyEnv {
    readonly size: { readonly width: number; readonly height: number };
    /** Absolute. */
    readonly file: string;
}

export interface BodyFrame {
    /** `llm.request · llm.chat · 118.2 KB · json · L 120–160 / 4,210 · match 3/41` */
    readonly header: Line;
    /** Every body of the span, the shown one marked; None for a span with one body. */
    readonly tabs: Option.Option<Line>;
    /** The truncation warning, or why only the preview shows. */
    readonly notice: Option.Option<Line>;
    /** The visible rows only. */
    readonly rows: ReadonlyArray<Line>;
    /** The status bar's left text while a search is set: `/ invoice · match 3/41`. */
    readonly query: Option.Option<string>;
    /** The input bar's right text. */
    readonly count: string;
}

/** The breadcrumb, the header and the status bar. */
const CHROME_ROWS = 3;

const noticeOf = (model: BodyModel, file: string): Option.Option<Line> => {
    const { content } = model;
    switch (content._tag) {
        case "Loading":
            return Option.none();
        case "Stored":
            return content.text.truncated
                ? Option.some([
                      chunk(
                          `⚠ truncated: showing ${count(content.text.storedBytes)} of ${count(content.text.bytes)} bytes`,
                          "warning",
                      ),
                  ])
                : Option.none();
        case "Preview":
            return Option.some([
                chunk(`⚠ ${problemText(model.ref, content.problem)} next to ${basename(file)}`, "warning"),
            ]);
    }
};

/** The rows the body text gets: the height less the chrome, the tab row and the notice. */
const viewportOf = (model: BodyModel, height: number): number =>
    Math.max(1, height - CHROME_ROWS - (model.refs.length > 1 ? 1 : 0) - (Option.isSome(noticeOf(model, "")) ? 1 : 0));

/** What the Body keys need: the same rows and viewport the frame draws. */
export const bodyContext = (
    model: BodyModel,
    view: BodyView,
    size: { readonly width: number; readonly height: number },
): BodyContext => ({
    model,
    rows: rowsOf(shownOf(model.content).doc, size.width, view.wrap),
    viewport: viewportOf(model, size.height),
    width: size.width,
});

const SEPARATOR = chunk(" · ", "faint");

const headerLine = (model: BodyModel, view: BodyView, context: BodyContext, top: number): Line => {
    const { content } = model;
    const { doc, matches } = shownOf(content);
    const { rows, viewport } = context;
    const last = Math.min(rows.count, top + viewport);
    const loaded =
        content._tag === "Loading"
            ? []
            : [
                  SEPARATOR,
                  chunk(`${doc.kind}${doc.raw ? " · raw" : ""}`, "muted"),
                  ...(content._tag === "Preview" ? [SEPARATOR, chunk("preview only", "warning")] : []),
                  SEPARATOR,
                  chunk(`L ${count(Math.min(top + 1, last))}–${count(last)} / ${count(rows.count)}`, "muted"),
                  ...(view.search === "" ? [] : [SEPARATOR, chunk(matchText(matches, view.current), "text")]),
              ];
    return cutLine(
        [
            chunk(model.ref.prefix, "text", true),
            SEPARATOR,
            chunk(model.spanName, "text"),
            SEPARATOR,
            chunk(size(model.ref.bytes), "muted"),
            ...loaded,
        ],
        context.width,
    );
};

const tabsLine = (model: BodyModel, width: number): Option.Option<Line> =>
    model.refs.length > 1
        ? Option.some(
              cutLine(
                  [
                      chunk(" ", "text"),
                      ...Arr.flatMap(model.refs, (ref, i) => [
                          ...(i > 0 ? [chunk(" │ ", "faint")] : []),
                          ref.prefix === model.ref.prefix
                              ? chunk(ref.prefix, "accent", true)
                              : chunk(ref.prefix, "muted"),
                      ]),
                  ],
                  width,
              ),
          )
        : Option.none();

export const bodyFrame = (model: BodyModel, view: BodyView, env: BodyEnv): BodyFrame => {
    const context = bodyContext(model, view, env.size);
    const { rows, viewport, width } = context;
    const { doc, matches } = shownOf(model.content);
    const { top, left } = clampedView(view, rows, viewport, width);
    const found = view.search === "" ? "" : matchText(matches, view.current);
    return {
        header: headerLine(model, view, context, top),
        tabs: tabsLine(model, width),
        notice: Option.map(noticeOf(model, env.file), (line) => cutLine(line, width)),
        rows:
            model.content._tag === "Loading"
                ? [[chunk("loading…", "muted")]]
                : Arr.makeBy(Math.min(viewport, rows.count - top), (i) =>
                      rowLine(doc, rows, matches, view.current, top + i, { left, width }),
                  ),
        query: view.search === "" ? Option.none() : Option.some(`/ ${view.search} · ${found}`),
        count: found,
    };
};
