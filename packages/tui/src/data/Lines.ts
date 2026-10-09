const NEWLINE = 0x0a;

const utf8 = new TextDecoder();

export interface Split {
    readonly lines: ReadonlyArray<string>;
    readonly offsets: ReadonlyArray<number>;
    readonly firstLine: number;
    readonly pending: Uint8Array;
    readonly nextLine: number;
}

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a, 0);
    joined.set(b, a.length);
    return joined;
};

const countNewlines = (bytes: Uint8Array): number => {
    let count = 0;
    for (let at = bytes.indexOf(NEWLINE); at !== -1; at = bytes.indexOf(NEWLINE, at + 1)) {
        count += 1;
    }
    return count;
};

export const splitLines = (pending: Uint8Array, chunk: Uint8Array, pendingOffset: number, nextLine: number): Split => {
    const bytes = pending.length === 0 ? chunk : concat(pending, chunk);
    let cursor = 0;
    const ends = Array.from({ length: countNewlines(bytes) }, () => {
        cursor = bytes.indexOf(NEWLINE, cursor) + 1;
        return cursor - 1;
    });
    const startOf = (i: number) => (i === 0 ? 0 : ends[i - 1] + 1);
    const lines = Array.from(ends, (end, i) => utf8.decode(bytes.subarray(startOf(i), end)));
    const offsets = Array.from(ends, (_, i) => pendingOffset + startOf(i));
    return {
        lines,
        offsets,
        firstLine: nextLine,
        pending: bytes.slice(cursor),
        nextLine: nextLine + ends.length,
    };
};
