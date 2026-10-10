import { Array as Arr, Option, Predicate } from "effect";

export type BodyKind = "json" | "text";

/** What `JSON.parse` returns. */
export type Json = string | number | boolean | null | ReadonlyArray<Json> | { readonly [key: string]: Json };

export type JsonRole = "jsonKey" | "jsonString" | "jsonNumber" | "jsonLiteral";

/** Colour runs over a doc's text: sorted and disjoint. Offsets no run covers are plain text. */
export interface Runs {
    readonly start: ReadonlyArray<number>;
    readonly end: ReadonlyArray<number>;
    readonly role: ReadonlyArray<JsonRole>;
}

/** A body as shown. Rows, matches and the current match are all offsets into `text`. */
export interface BodyDoc {
    readonly kind: BodyKind;
    readonly raw: boolean;
    /** What is drawn, searched and copied: pretty JSON, or the stored text exactly. */
    readonly text: string;
    /** Line i is `text[lineStarts[i], lineStarts[i + 1] - 1)`; the last entry is `text.length + 1`. */
    readonly lineStarts: ReadonlyArray<number>;
    readonly runs: Runs;
}

const noRuns: Runs = { start: [], end: [], role: [] };

const linesOf = (text: string): ReadonlyArray<number> => {
    const starts = [0];
    for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) {
        starts[starts.length] = at + 1;
    }
    starts[starts.length] = text.length + 1;
    return starts;
};

const plain = (text: string, kind: BodyKind, raw: boolean): BodyDoc => ({
    kind,
    raw,
    text,
    lineStarts: linesOf(text),
    runs: noRuns,
});

export const emptyDoc: BodyDoc = plain("", "text", false);

const parse = Option.liftThrowable((text: string): Json => JSON.parse(text));

/** The parsed value when the trimmed text starts with `{` or `[` and `JSON.parse` accepts it. */
export const detect = (text: string): Option.Option<Json> => {
    const first = text.trimStart().charAt(0);
    return first === "{" || first === "[" ? parse(text) : Option.none();
};

const isList = (node: Json): node is ReadonlyArray<Json> => Array.isArray(node);

const pad = (n: number): string => " ".repeat(n);

const escaped = (piece: string): string => JSON.stringify(piece).slice(1, -1);

interface Pretty {
    readonly text: string;
    readonly runs: Runs;
}

/** Two-space JSON whose strings show their `\n` as real lines, indented two past the line that opens them. */
const pretty = (value: Json): Pretty => {
    const parts: Array<string> = [];
    const start: Array<number> = [];
    const end: Array<number> = [];
    const role: Array<JsonRole> = [];
    let at = 0;
    const emit = (text: string, as?: JsonRole) => {
        if (as !== undefined) {
            start[start.length] = at;
            end[end.length] = at + text.length;
            role[role.length] = as;
        }
        parts[parts.length] = text;
        at += text.length;
    };
    const members = <A>(open: string, close: string, items: ReadonlyArray<A>, indent: number, f: (a: A) => void) => {
        if (items.length === 0) {
            emit(`${open}${close}`);
            return;
        }
        emit(open);
        Arr.forEach(items, (item, i) => {
            emit(`${i === 0 ? "\n" : ",\n"}${pad(indent + 2)}`);
            f(item);
        });
        emit(`\n${pad(indent)}${close}`);
    };
    const walk = (node: Json, indent: number): void => {
        if (Predicate.isString(node)) {
            const [first = "", ...rest] = node.split("\n");
            const continued = Arr.join(
                Arr.map(rest, (piece) => `\n${pad(indent + 2)}${escaped(piece)}`),
                "",
            );
            emit(`"${escaped(first)}${continued}"`, "jsonString");
        } else if (Predicate.isNumber(node)) {
            emit(String(node), "jsonNumber");
        } else if (node === null || Predicate.isBoolean(node)) {
            emit(String(node), "jsonLiteral");
        } else if (isList(node)) {
            members("[", "]", node, indent, (item) => walk(item, indent + 2));
        } else {
            members("{", "}", Object.entries(node), indent, ([key, item]) => {
                emit(JSON.stringify(key), "jsonKey");
                emit(": ");
                walk(item, indent + 2);
            });
        }
    };
    walk(value, 0);
    return { text: Arr.join(parts, ""), runs: { start, end, role } };
};

// Nesting deep enough to overflow the walk's stack shows the body as text.
const prettyOrNone = Option.liftThrowable(pretty);

/** `parsed` is `detect(text)`. Raw view and plain text show `text` exactly. */
export const docOf = (text: string, parsed: Option.Option<Json>, raw: boolean): BodyDoc => {
    const kind: BodyKind = Option.isSome(parsed) ? "json" : "text";
    if (raw || Option.isNone(parsed)) {
        return plain(text, kind, raw);
    }
    return Option.match(prettyOrNone(parsed.value), {
        onNone: () => plain(text, "text", false),
        onSome: (shown) => ({ kind, raw, text: shown.text, lineStarts: linesOf(shown.text), runs: shown.runs }),
    });
};
