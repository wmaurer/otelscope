import { Data, Option } from "effect";

import { emptyDoc } from "./bodyDoc.ts";
import { matchesOf } from "./bodySearch.ts";

import type { BodyText } from "../data/Bodies.ts";
import type { BodyRef } from "./bodies.ts";
import type { BodyDoc } from "./bodyDoc.ts";
import type { BodyMatches } from "./bodySearch.ts";

export type BodyContent = Data.TaggedEnum<{
    Loading: {};
    /** The stored file. */
    Stored: { readonly text: BodyText; readonly doc: BodyDoc; readonly matches: BodyMatches };
    /**
     * The file is missing or unreadable, so the doc is the span's `.preview`. `problem` is the read error, None when
     * the file is not there.
     */
    Preview: { readonly problem: Option.Option<string>; readonly doc: BodyDoc; readonly matches: BodyMatches };
}>;
export const BodyContent = Data.taggedEnum<BodyContent>();

/** The top Body screen's body: no size and no scroll position, so scrolling rebuilds none of it. */
export interface BodyModel {
    readonly spanName: string;
    /** `bodiesOf(span)`: the tab row and Tab's order. */
    readonly refs: ReadonlyArray<BodyRef>;
    readonly ref: BodyRef;
    readonly content: BodyContent;
}

export interface Shown {
    readonly doc: BodyDoc;
    readonly matches: BodyMatches;
}

const nothingShown: Shown = { doc: emptyDoc, matches: matchesOf(emptyDoc, "") };

/** `bodies/<sha256>.txt not found`, or the read error in place of "not found". */
export const problemText = (ref: BodyRef, problem: Option.Option<string>): string =>
    `bodies/${ref.sha256}.txt ${Option.getOrElse(problem, () => "not found")}`;

/** The doc on screen and its matches; nothing while loading. */
export const shownOf = (content: BodyContent): Shown => (content._tag === "Loading" ? nothingShown : content);
