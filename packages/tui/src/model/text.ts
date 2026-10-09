import { Array as Arr, Option } from "effect";

import type { Chunk, Line } from "./Role.ts";

export const cells = (text: string): number => text.length;

export const lineCells = (line: Line): number => Arr.reduce(line, 0, (sum, chunk) => sum + cells(chunk.text));

export const lineText = (line: Line): string =>
    Arr.join(
        Arr.map(line, (chunk) => chunk.text),
        "",
    );

export const cut = (text: string, width: number): string => {
    if (cells(text) <= width) {
        return text;
    }
    return width <= 0 ? "" : `${text.slice(0, width - 1)}…`;
};

export const cutLine = (line: Line, width: number): Line => {
    if (lineCells(line) <= width) {
        return line;
    }
    const kept = Arr.reduce(line, { room: width - 1, chunks: Arr.empty<Chunk>() }, ({ room, chunks }, chunk) =>
        room <= 0
            ? { room, chunks }
            : { room: room - cells(chunk.text), chunks: [...chunks, { ...chunk, text: chunk.text.slice(0, room) }] },
    ).chunks;
    return Option.match(Arr.last(kept), {
        onNone: () => [],
        onSome: (last) => [...Arr.dropRight(kept, 1), { ...last, text: `${last.text}…` }],
    });
};
