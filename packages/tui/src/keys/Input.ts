import { Array as Arr, Option } from "effect";

export interface LineEdit {
    readonly text: string;
    readonly cursor: number;
}

export type EditOp = "left" | "right" | "home" | "end" | "backspace" | "deleteWord" | "deleteToStart";

export const insert = (line: LineEdit, text: string): LineEdit => ({
    text: `${line.text.slice(0, line.cursor)}${text}${line.text.slice(line.cursor)}`,
    cursor: line.cursor + text.length,
});

const wordStart = (text: string, cursor: number): number => {
    let at = cursor;
    while (at > 0 && /\s/.test(text.charAt(at - 1))) {
        at -= 1;
    }
    while (at > 0 && !/\s/.test(text.charAt(at - 1))) {
        at -= 1;
    }
    return at;
};

const deleteBack = (line: LineEdit, from: number): LineEdit =>
    from === line.cursor ? line : { text: `${line.text.slice(0, from)}${line.text.slice(line.cursor)}`, cursor: from };

const moveTo = (line: LineEdit, cursor: number): LineEdit => {
    const at = Math.min(line.text.length, Math.max(0, cursor));
    return at === line.cursor ? line : { text: line.text, cursor: at };
};

export const edit = (line: LineEdit, op: EditOp): LineEdit => {
    switch (op) {
        case "left":
            return moveTo(line, line.cursor - 1);
        case "right":
            return moveTo(line, line.cursor + 1);
        case "home":
            return moveTo(line, 0);
        case "end":
            return moveTo(line, line.text.length);
        case "backspace":
            return deleteBack(line, Math.max(0, line.cursor - 1));
        case "deleteWord":
            return deleteBack(line, wordStart(line.text, line.cursor));
        case "deleteToStart":
            return deleteBack(line, 0);
    }
};

export type History = ReadonlyArray<string>;

export const HISTORY_MAX = 100;

export const remember = (history: History, query: string): History =>
    query === "" ? history : Arr.take([query, ...Arr.filter(history, (q) => q !== query)], HISTORY_MAX);

export interface Recall {
    readonly index: number;
    readonly typed: string;
}

interface Recalled {
    readonly text: string;
    readonly recall: Option.Option<Recall>;
}

export const recall = (
    history: History,
    text: string,
    current: Option.Option<Recall>,
    dir: "older" | "newer",
): Recalled => {
    const typed = Option.match(current, { onNone: () => text, onSome: (r) => r.typed });
    const index = Option.match(current, { onNone: () => -1, onSome: (r) => r.index }) + (dir === "older" ? 1 : -1);
    if (index < 0) {
        return Option.isNone(current) ? { text, recall: current } : { text: typed, recall: Option.none() };
    }
    return Option.match(Arr.get(history, index), {
        onNone: () => ({ text, recall: current }),
        onSome: (entry) => ({ text: entry, recall: Option.some({ index, typed }) }),
    });
};
