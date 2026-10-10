import { Array as Arr, Data, Option } from "effect";

import type { Exit } from "../data/Snapshot.ts";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type Needle = Data.TaggedEnum<{
    Folded: { readonly lower: string };
    Exact: { readonly text: string };
}>;
export const Needle = Data.taggedEnum<Needle>();

export type Term = Data.TaggedEnum<{
    Text: { readonly needle: Needle };
    Attr: { readonly key: string; readonly value: Option.Option<Needle> };
    Exit: { readonly exit: Exit };
    Level: { readonly level: LogLevel };
    Never: { readonly raw: string };
}>;
export const Term = Data.taggedEnum<Term>();

export type Query = ReadonlyArray<Term>;

export const needle = (text: string): Needle =>
    text.toLowerCase() === text ? Needle.Folded({ lower: text }) : Needle.Exact({ text });

const exitOf = (value: string): Exit | undefined => {
    switch (value) {
        case "failed":
            return "Failure";
        case "interrupted":
            return "Interrupted";
        case "ok":
            return "Success";
        default:
            return undefined;
    }
};
const levels: ReadonlySet<string> = new Set<LogLevel>(["trace", "debug", "info", "warn", "error", "fatal"]);
const isLevel = (value: string): value is LogLevel => levels.has(value);

interface Token {
    readonly text: string;
    readonly quoted: boolean;
}

const tokenize = (query: string): Option.Option<ReadonlyArray<Token>> => {
    const tokens: Array<Token> = [];
    let text = "";
    let quoted = false;
    let started = false;
    let inQuote = false;
    for (const char of query) {
        if (inQuote) {
            if (char === '"') {
                inQuote = false;
            } else {
                text += char;
            }
        } else if (char === '"') {
            inQuote = true;
            quoted = quoted || !started;
            started = true;
        } else if (/\s/.test(char)) {
            if (started) {
                tokens[tokens.length] = { text, quoted };
            }
            text = "";
            quoted = false;
            started = false;
        } else {
            text += char;
            started = true;
        }
    }
    if (inQuote) {
        return Option.none();
    }
    if (started) {
        tokens[tokens.length] = { text, quoted };
    }
    return Option.some(tokens);
};

const classify = (token: Token): Option.Option<Term> => {
    if (token.text === "") {
        return Option.none();
    }
    if (token.quoted) {
        return Option.some(Term.Text({ needle: needle(token.text) }));
    }
    if (token.text.startsWith("is:")) {
        const value = token.text.slice(3);
        const exit = exitOf(value);
        if (exit !== undefined) {
            return Option.some(Term.Exit({ exit }));
        }
        return Option.some(isLevel(value) ? Term.Level({ level: value }) : Term.Never({ raw: token.text }));
    }
    const equals = token.text.indexOf("=");
    if (equals > 0) {
        const value = token.text.slice(equals + 1);
        return Option.some(
            Term.Attr({
                key: token.text.slice(0, equals),
                value: value === "" ? Option.none() : Option.some(needle(value)),
            }),
        );
    }
    return Option.some(Term.Text({ needle: needle(token.text) }));
};

export const parse = (query: string): Query =>
    Option.match(tokenize(query), {
        onSome: (tokens) => Arr.getSomes(Arr.map(tokens, classify)),
        onNone: () =>
            Arr.map(
                Arr.filter(query.split(/\s+/), (word) => word !== ""),
                (word) => Term.Text({ needle: needle(word) }),
            ),
    });

const needleKey = (n: Needle): string => (n._tag === "Folded" ? `i${n.lower}` : `C${n.text}`);

export const termKey = (term: Term): string =>
    Term.$match(term, {
        Text: ({ needle }) => `t:${needleKey(needle)}`,
        Attr: ({ key, value }) => `a:${key}=${Option.match(value, { onNone: () => "", onSome: needleKey })}`,
        Exit: ({ exit }) => `e:${exit}`,
        Level: ({ level }) => `l:${level}`,
        Never: () => "n",
    });
