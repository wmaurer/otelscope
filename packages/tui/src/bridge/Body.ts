import { Array as Arr, Cause, Equal, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { bodiesOf } from "../model/bodies.ts";
import { detect, docOf } from "../model/bodyDoc.ts";
import { BodyContent } from "../model/bodyModel.ts";
import { matchesOf } from "../model/bodySearch.ts";
import { top } from "../nav/Nav.ts";

import type { BodyMissing, BodyReadFailed, BodyText } from "../data/Bodies.ts";
import type { Snapshot } from "../data/Snapshot.ts";
import type { BodyRef } from "../model/bodies.ts";
import type { Json } from "../model/bodyDoc.ts";
import type { BodyModel } from "../model/bodyModel.ts";
import type { Nav } from "../nav/Nav.ts";
import type { BodyKey } from "./Atoms.ts";

type BodyResult = AsyncResult.AsyncResult<BodyText, BodyMissing | BodyReadFailed>;

interface Target {
    readonly spanName: string;
    readonly refs: ReadonlyArray<BodyRef>;
    readonly ref: BodyRef;
}

/** What the doc is built from: the stored text, or the span's `.preview` when the file cannot be read. */
interface Source {
    readonly text: string;
    readonly parsed: Option.Option<Json>;
}

/**
 * The top Body screen's body, in stages that each rebuild only when their own inputs change. The target compares
 * structurally, so a live tail that leaves the span alone rebuilds nothing; the text is parsed once per body, the doc
 * follows `raw` and the matches follow `search`. Scrolling changes none of them.
 */
export const bodyModelAtom = (
    snapshot: Atom.Atom<Snapshot>,
    nav: Atom.Atom<Nav>,
    body: (key: BodyKey) => Atom.Atom<BodyResult>,
): Atom.Atom<Option.Option<BodyModel>> => {
    const target = Atom.make((get): Target | undefined => {
        const screen = top(get(nav));
        if (screen._tag !== "Body") {
            return undefined;
        }
        const span = get(snapshot).traces.get(screen.traceId)?.spans.get(screen.spanId);
        if (span === undefined) {
            return undefined;
        }
        const refs = bodiesOf(span);
        return Option.match(
            Arr.findFirst(refs, (ref) => ref.prefix === screen.prefix),
            { onNone: () => undefined, onSome: (ref) => ({ spanName: span.name, refs, ref }) },
        );
    }).pipe(Atom.withEquality(Equal.equals));
    const raw = Atom.make((get) => {
        const screen = top(get(nav));
        return screen._tag === "Body" && screen.view.raw;
    });
    const search = Atom.make((get) => {
        const screen = top(get(nav));
        return screen._tag === "Body" ? screen.view.search : "";
    });
    const result = Atom.make((get): BodyResult | undefined => {
        const shown = get(target);
        return shown === undefined ? undefined : get(body({ sha256: shown.ref.sha256, bytes: shown.ref.bytes }));
    });
    const source = Atom.make((get): Source | undefined => {
        const loaded = get(result);
        const shown = get(target);
        if (loaded === undefined || shown === undefined || AsyncResult.isInitial(loaded)) {
            return undefined;
        }
        return AsyncResult.isSuccess(loaded)
            ? { text: loaded.value.text, parsed: detect(loaded.value.text) }
            : { text: shown.ref.preview, parsed: Option.none() };
    });
    const doc = Atom.make((get) => {
        const from = get(source);
        return from === undefined ? undefined : docOf(from.text, from.parsed, get(raw));
    });
    const matches = Atom.make((get) => {
        const shown = get(doc);
        return shown === undefined ? undefined : matchesOf(shown, get(search));
    });
    return Atom.make((get): Option.Option<BodyModel> => {
        const shown = get(target);
        const loaded = get(result);
        if (shown === undefined || loaded === undefined) {
            return Option.none();
        }
        const current = get(doc);
        const found = get(matches);
        const content =
            current === undefined || found === undefined || AsyncResult.isInitial(loaded)
                ? BodyContent.Loading()
                : AsyncResult.isSuccess(loaded)
                  ? BodyContent.Stored({ text: loaded.value, doc: current, matches: found })
                  : BodyContent.Preview({
                        problem: Option.flatMap(Cause.findErrorOption(loaded.cause), (error) =>
                            error._tag === "BodyReadFailed" ? Option.some(error.message) : Option.none(),
                        ),
                        doc: current,
                        matches: found,
                    });
        return Option.some({ ...shown, content });
    });
};
