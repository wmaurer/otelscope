import { Array as Arr, Option } from "effect";

import { basename, clockTime, count, plural, sizePair } from "./format.ts";
import { isLive } from "./marks.ts";
import { chunk } from "./Role.ts";
import { cut, cutLine, lineCells } from "./text.ts";

import type { BadLines, ResetReason, Snapshot, Status } from "../data/Snapshot.ts";
import type { HintItem } from "../keys/Hints.ts";
import type { Line } from "./Role.ts";

export const FLASH_MILLIS = 5000;

export interface StatusInput {
    readonly hints: ReadonlyArray<HintItem>;
    readonly message: Option.Option<string>;
    readonly query: Option.Option<string>;
    readonly newRows: Option.Option<string>;
    readonly snapshot: Snapshot;
    /** Absolute. */
    readonly file: string;
    readonly now: number;
}

const resetNotice = {
    truncated: "file truncated — reloaded",
    replaced: "file replaced — reloaded",
    removed: "file removed",
} satisfies Readonly<Record<ResetReason, string>>;

export const resetFlash = (status: Status, now: number): Option.Option<string> =>
    Option.flatMap(status.lastReset, ({ reason, at }) =>
        now - at < FLASH_MILLIS ? Option.some(resetNotice[reason]) : Option.none(),
    );

export const phasePart = (status: Status, file: string, now: number): Line => {
    if (Option.isSome(status.error)) {
        return [chunk(`⚠ ${status.error.value}`, "failure")];
    }
    switch (status.phase) {
        case "waiting":
            return [chunk(`waiting for ${file}…`, "muted")];
        case "loading": {
            const percent = status.bytesTotal > 0 ? Math.floor((status.bytesRead * 100) / status.bytesTotal) : 0;
            return [chunk(`loading ${percent}% · ${sizePair(status.bytesRead, status.bytesTotal)}`, "muted")];
        }
        case "following": {
            const reloaded = Option.filter(status.lastReset, ({ at }) =>
                Option.match(status.lastRecordAt, { onNone: () => true, onSome: (record) => record <= at }),
            );
            if (Option.isSome(reloaded)) {
                return [chunk(`following · reloaded ${clockTime(reloaded.value.at)}`, "muted")];
            }
            const live = isLive(status.lastRecordAt, status.phase, now);
            return live ? [chunk("● following", "live")] : [chunk("following", "muted")];
        }
        case "done":
            return [chunk("read once", "muted")];
    }
};

export const problemsPart = (badLines: BadLines): Option.Option<Line> => {
    const malformed = badLines.malformed > 0 ? [chunk(`⚠ ${plural(badLines.malformed, "bad line")}`, "warning")] : [];
    const legacy =
        badLines.legacy > 0
            ? [
                  chunk(
                      `${count(badLines.legacy)} ${badLines.legacy === 1 ? "line" : "lines"} from otelscope < 0.3 skipped`,
                      "muted",
                  ),
              ]
            : [];
    const parts = [
        ...malformed,
        ...(malformed.length > 0 && legacy.length > 0 ? [chunk("  ", "muted")] : []),
        ...legacy,
    ];
    return Arr.isReadonlyArrayNonEmpty(parts) ? Option.some(parts) : Option.none();
};

export const sizePart = (snapshot: Snapshot): Line => [
    chunk(`${plural(snapshot.runs.size, "run")} · ${plural(snapshot.spanCount, "span")}`, "muted"),
];

const hintsLine = (hints: ReadonlyArray<HintItem>): Line =>
    Arr.flatMap(hints, (hint, i) => [
        ...(i > 0 ? [chunk(" · ", "faint")] : []),
        chunk(hint.key, "text"),
        chunk(` ${hint.label}`, "muted"),
    ]);

const GAP = 2;

interface Parts {
    readonly hints: ReadonlyArray<HintItem>;
    readonly text: Option.Option<string>;
    readonly newRows: Option.Option<Line>;
    readonly problems: Option.Option<Line>;
    readonly file: Option.Option<Line>;
    readonly phase: Line;
    readonly size: Option.Option<Line>;
}

const leftOf = (parts: Parts): Line =>
    Option.match(parts.text, { onNone: () => hintsLine(parts.hints), onSome: (text) => [chunk(text, "text")] });

const rightOf = (parts: Parts): Line =>
    Arr.flatMap(
        Arr.getSomes([parts.newRows, parts.problems, parts.file, Option.some(parts.phase), parts.size]),
        (part, i) => (i > 0 ? [chunk("  ", "muted"), ...part] : part),
    );

const widthOf = (parts: Parts): number => {
    const left = lineCells(leftOf(parts));
    const right = lineCells(rightOf(parts));
    return left + right + (left > 0 && right > 0 ? GAP : 0);
};

const dropLastHint = (parts: Parts): Parts => {
    const index = Arr.findLastIndex(parts.hints, (hint) => !hint.sticky);
    return Option.match(index, {
        onNone: () => parts,
        onSome: (i) => ({ ...parts, hints: Arr.remove(parts.hints, i) }),
    });
};

export const statusBar = (input: StatusInput, width: number): Line => {
    const start: Parts = {
        hints: input.hints,
        text: Option.firstSomeOf([input.message, resetFlash(input.snapshot.status, input.now), input.query]),
        newRows: Option.map(input.newRows, (text) => [chunk(text, "accent")]),
        problems: problemsPart(input.snapshot.badLines),
        file: Option.some([chunk(basename(input.file), "muted")]),
        phase: phasePart(input.snapshot.status, input.file, input.now),
        size: Option.some(sizePart(input.snapshot)),
    };
    const narrowings: ReadonlyArray<(parts: Parts) => Parts> = [
        ...Arr.replicate(dropLastHint, input.hints.length),
        (parts) => ({ ...parts, newRows: Option.none() }),
        (parts) => ({ ...parts, problems: Option.none() }),
        (parts) => ({ ...parts, file: Option.none() }),
        (parts) => ({ ...parts, size: Option.none() }),
        (parts) => ({ ...parts, hints: [] }),
        (parts) => {
            const room = width - lineCells(rightOf(parts)) - GAP;
            return { ...parts, text: room > 1 ? Option.map(parts.text, (text) => cut(text, room)) : Option.none() };
        },
        (parts) => ({ ...parts, phase: cutLine(parts.phase, width) }),
    ];
    const parts = Arr.reduce(narrowings, start, (current, narrow) =>
        widthOf(current) <= width ? current : narrow(current),
    );
    const left = leftOf(parts);
    const right = rightOf(parts);
    return [...left, chunk(" ".repeat(Math.max(0, width - lineCells(left) - lineCells(right))), "text"), ...right];
};
