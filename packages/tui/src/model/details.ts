import { Array as Arr, Option, Order, pipe } from "effect";

import { bodiesOf, bodyState } from "./bodies.ts";
import { causeLines, causeOf, thrownOf } from "./cause.ts";
import { clockTime, count, duration, offset, plural, runLabel, size, valueText, where } from "./format.ts";
import { LOG_LEVEL, levelOf, levelRole } from "./levels.ts";
import { chunk, heading } from "./Role.ts";
import { cut, cutLine } from "./text.ts";
import { TreeEntry } from "./tree.ts";

import type { SpanId, Snapshot } from "../data/Snapshot.ts";
import type { BodyRef } from "./bodies.ts";
import type { Chunk, Line } from "./Role.ts";
import type { Group, TreeFacts } from "./treeFacts.ts";
import type { JsonlSpanEvent, JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";
import type { AsyncResult } from "effect/reactivity";

export interface DetailRow {
    readonly line: Line;
    /** Some(prefix) on a Bodies row: a click opens that body. */
    readonly body: Option.Option<string>;
}

export interface DetailsEnv {
    readonly facts: TreeFacts;
    /** For run labels, when the trace spans several runs. */
    readonly snapshot: Snapshot;
    readonly now: number;
    /** `Bodies.stat` results by sha256. */
    readonly bodyStats: ReadonlyMap<string, AsyncResult.AsyncResult<Option.Option<number>>>;
    /** The pane's inner width: long attribute values wrap, other long lines are cut. */
    readonly width: number;
}

const HIDDEN: ReadonlySet<string> = new Set(["span.label", "status.interrupted"]);
const BODY_SUFFIXES = [".sha256", ".bytes", ".preview"];
const PROBLEMS_SHOWN = 20;

const byKey = Order.mapInput(Order.String, (entry: readonly [string, string]) => entry[0]);

/** The Attributes section's pairs, sorted by key, without what the header, exit and Bodies already show. */
export const shownAttributes = (span: JsonlSpanRecord): ReadonlyArray<readonly [key: string, value: string]> => {
    const bodyKeys = new Set(
        Arr.flatMap(bodiesOf(span), (ref) => Arr.map(BODY_SUFFIXES, (suffix) => `${ref.prefix}${suffix}`)),
    );
    return pipe(
        Object.entries(span.attrs),
        Arr.filter(([key]) => !HIDDEN.has(key) && !bodyKeys.has(key)),
        Arr.map(([key, value]): readonly [string, string] => [key, valueText(value)]),
        Arr.sort(byKey),
    );
};

const plain = (line: Line): DetailRow => ({ line, body: Option.none() });

const exitChunk = (span: JsonlSpanRecord): Chunk =>
    span.exit === "Failure"
        ? chunk("✗ Failure", "failure")
        : span.exit === "Interrupted"
          ? chunk("⊘ Interrupted", "interrupted")
          : chunk("Success", "text");

const header = (span: JsonlSpanRecord, env: DetailsEnv): ReadonlyArray<Line> => {
    const { trace } = env.facts;
    const ids = [
        `span ${span.span}`,
        ...(span.parent === null ? [] : [`parent ${span.parent}`]),
        ...(span.fiber === null ? [] : [`#${span.fiber}`]),
    ];
    const run =
        trace.runs.length > 1
            ? [
                  `run ${Option.match(Option.fromUndefinedOr(env.snapshot.runs.get(span.run)), {
                      onNone: () => span.run,
                      onSome: (known) => runLabel(known, env.now),
                  })}`,
              ]
            : [];
    return [
        [chunk(span.name, "text", true), chunk("  ", "text"), exitChunk(span)],
        [
            chunk(
                `${duration(span.ms)} · ${offset(span.startMs - trace.startMs)} · ${clockTime(span.startMs, "millis")}`,
                "muted",
            ),
        ],
        [chunk(Arr.join(ids, " · "), "muted")],
        ...Arr.map(run, (text) => [chunk(text, "muted")]),
        ...(span.site === null ? [] : [[chunk("at ", "muted"), chunk(where(span.site), "text")]]),
        ...(span.def === null ? [] : [[chunk("defined at ", "muted"), chunk(where(span.def), "text")]]),
    ];
};

const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, " ");

const STATE_MARK = { truncated: " ⚠ truncated", missing: " ⚠ missing" } as const;

const bodyRow = (ref: BodyRef, env: DetailsEnv): DetailRow => {
    const state = bodyState(ref, Option.fromUndefinedOr(env.bodyStats.get(ref.sha256)));
    const mark = state === "truncated" || state === "missing" ? STATE_MARK[state] : "";
    const lead = `${ref.prefix}  ${size(ref.bytes)}  `;
    const room = env.width - lead.length - mark.length;
    const line: Line = [
        chunk(ref.prefix, "text"),
        chunk(`  ${size(ref.bytes)}  `, "muted"),
        chunk(cut(oneLine(ref.preview), Math.max(0, room)), "muted"),
        ...(mark === "" ? [] : [chunk(mark, "warning")]),
    ];
    return { line: cutLine(line, env.width), body: Option.some(ref.prefix) };
};

/** `text` in pieces of `first` cells, then of `rest` cells; one empty piece for an empty text. */
const pieces = (text: string, first: number, rest: number): ReadonlyArray<string> =>
    text.length <= first
        ? [text]
        : [
              text.slice(0, first),
              ...Arr.makeBy(Math.ceil((text.length - first) / rest), (i) =>
                  text.slice(first + i * rest, first + (i + 1) * rest),
              ),
          ];

/** `key  value`, the value wrapped under itself (or under half the width for a long key). */
const attributeLines = (key: string, value: string, width: number): ReadonlyArray<Line> => {
    const lead = `${key}  `;
    const indent = Math.min(lead.length, Math.floor(width / 2));
    const rest = Math.max(1, width - indent);
    const first = width - lead.length;
    const onKeyLine = first >= 1;
    const parts = Arr.flatMap(value.split("\n"), (paragraph, i) =>
        pieces(paragraph, i === 0 && onKeyLine ? first : rest, rest),
    );
    const continued = (part: string): Line => [chunk(" ".repeat(indent), "text"), chunk(part, "text")];
    return onKeyLine
        ? [[chunk(lead, "muted"), chunk(parts[0] ?? "", "text")], ...Arr.map(Arr.drop(parts, 1), continued)]
        : [[chunk(cut(key, width), "muted")], ...Arr.map(parts, continued)];
};

const LOG_HIDDEN: ReadonlySet<string> = new Set([LOG_LEVEL, "effect.fiberId"]);
const NOTHING_HIDDEN: ReadonlySet<string> = new Set();

const pairs = (attrs: JsonlSpanEvent["attrs"], hidden: ReadonlySet<string>): string =>
    pipe(
        Object.entries(attrs),
        Arr.filter(([key]) => !hidden.has(key)),
        Arr.map(([key, value]) => `${key}=${oneLine(valueText(value))}`),
        Arr.join(" "),
    );

const eventLine = (event: JsonlSpanEvent): Line => {
    const at = chunk(`${offset(event.offsetMs)}  `, "muted");
    if (event.name === "exception") {
        const type = valueText(event.attrs["exception.type"] ?? "");
        const message = valueText(event.attrs["exception.message"] ?? "");
        return [
            at,
            chunk("exception  ", "text"),
            chunk(message === "" ? type : `${type}: ${oneLine(message)}`, "failure"),
        ];
    }
    const tail = (hidden: ReadonlySet<string>): Line => {
        const text = pairs(event.attrs, hidden);
        return text === "" ? [] : [chunk(`  ${text}`, "muted")];
    };
    return Option.match(levelOf(event.attrs), {
        onNone: () => [at, chunk(oneLine(event.name), "text"), ...tail(NOTHING_HIDDEN)],
        onSome: (level) => [
            at,
            chunk(level, levelRole[level]),
            chunk(`  ${oneLine(event.name)}`, "text"),
            ...tail(LOG_HIDDEN),
        ],
    });
};

const byOffset = Order.mapInput(Order.Number, (event: JsonlSpanEvent) => event.offsetMs);

const sections = (blocks: ReadonlyArray<ReadonlyArray<DetailRow>>): ReadonlyArray<DetailRow> =>
    pipe(
        blocks,
        Arr.filter((block) => block.length > 0),
        Arr.flatMap((block: ReadonlyArray<DetailRow>, i) => (i === 0 ? block : [plain([]), ...block])),
    );

const spanDetails = (span: JsonlSpanRecord, env: DetailsEnv): ReadonlyArray<DetailRow> => {
    const { width } = env;
    const cutRows = (lines: ReadonlyArray<Line>) => Arr.map(lines, (line) => plain(cutLine(line, width)));
    const bodies = bodiesOf(span);
    const attributes = shownAttributes(span);
    const events = Arr.sort(span.events, byOffset);
    return sections([
        cutRows(header(span, env)),
        Arr.map(causeLines(causeOf(env.facts, span.span), env.facts, width), plain),
        bodies.length === 0 ? [] : [plain(heading("Bodies")), ...Arr.map(bodies, (ref) => bodyRow(ref, env))],
        attributes.length === 0
            ? []
            : [
                  plain(heading("Attributes")),
                  ...Arr.map(
                      Arr.flatMap(attributes, ([key, value]) => attributeLines(key, value, width)),
                      plain,
                  ),
              ],
        events.length === 0
            ? []
            : cutRows([heading(`Events (${count(events.length)})`), ...Arr.map(events, eventLine)]),
    ]);
};

/** Nearest rank: the smallest value with at least `p` of the values at or below it. */
const percentile = (sorted: ReadonlyArray<number>, p: number): number =>
    sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;

const problemLine = (facts: TreeFacts, group: Group, id: SpanId, index: number): Line => {
    const span = facts.trace.spans.get(id);
    const interrupted = span?.exit === "Interrupted";
    const type = Option.match(
        Option.flatMap(Option.fromUndefinedOr(span), (s) => Arr.head(thrownOf(s))),
        {
            onNone: () => [],
            onSome: (first) => [chunk(`  ${first.type}`, "text")],
        },
    );
    return [
        interrupted ? chunk("⊘ ", "interrupted") : chunk("✗ ", "failure"),
        chunk(`${group.name} #${index + 1}`, "text"),
        ...type,
    ];
};

const groupDetails = (group: Group, env: DetailsEnv): ReadonlyArray<DetailRow> => {
    const { facts, width } = env;
    const spans = Arr.getSomes(Arr.map(group.members, (id) => Option.fromUndefinedOr(facts.trace.spans.get(id))));
    const durations = Arr.sort(
        Arr.map(spans, (span) => span.ms),
        Order.Number,
    );
    const ok = spans.length - group.failed - group.interrupted;
    const exits: Line = Arr.intersperse(
        [
            ...(ok > 0 ? [chunk(`${count(ok)} ok`, "text")] : []),
            ...(group.failed > 0 ? [chunk(`${count(group.failed)} failed`, "failure")] : []),
            ...(group.interrupted > 0 ? [chunk(`${count(group.interrupted)} interrupted`, "interrupted")] : []),
        ],
        chunk(" · ", "muted"),
    );
    const problems = Arr.filter(
        Arr.map(group.members, (id, index) => [id, index] as const),
        ([id]) => group.problems.has(id),
    );
    const hidden = problems.length - PROBLEMS_SHOWN;
    const stat = (label: string, ms: number): string => `${label} ${duration(ms)}`;
    return sections([
        Arr.map(
            [
                [chunk(group.name, "text", true), chunk(` ×${count(group.members.length)}`, "muted")],
                exits,
                [
                    chunk(
                        Arr.join(
                            [
                                stat("min", durations[0] ?? 0),
                                stat("p50", percentile(durations, 0.5)),
                                stat("p95", percentile(durations, 0.95)),
                                stat("max", durations[durations.length - 1] ?? 0),
                            ],
                            " · ",
                        ),
                        "muted",
                    ),
                ],
            ],
            (line) => plain(cutLine(line, width)),
        ),
        Arr.map(
            [
                ...Arr.map(Arr.take(problems, PROBLEMS_SHOWN), ([id, index]) => problemLine(facts, group, id, index)),
                ...(hidden > 0 ? [[chunk(`… and ${count(hidden)} more`, "muted")]] : []),
            ],
            (line) => plain(cutLine(line, width)),
        ),
    ]);
};

const missingDetails = (parentId: SpanId, env: DetailsEnv): ReadonlyArray<DetailRow> => {
    const n = env.facts.trace.children.get(parentId)?.length ?? 0;
    return Arr.map(
        [
            [chunk("Missing parent ", "muted"), chunk(parentId, "text")],
            [chunk(`${plural(n, "span")} reference${n === 1 ? "s" : ""} it.`, "muted")],
        ],
        (line) => plain(cutLine(line, env.width)),
    );
};

/** The details pane's rows for a span, a same-name group or a missing parent. Empty sections are hidden. */
export const detailsOf = (entry: TreeEntry, env: DetailsEnv): ReadonlyArray<DetailRow> =>
    TreeEntry.$match(entry, {
        Span: ({ spanId }) =>
            Option.match(Option.fromUndefinedOr(env.facts.trace.spans.get(spanId)), {
                onNone: () => [],
                onSome: (span) => spanDetails(span, env),
            }),
        Group: ({ group }) => groupDetails(group, env),
        Missing: ({ parentId }) => missingDetails(parentId, env),
    });
