const before = (keyA: number, idA: string, keyB: number, idB: string): boolean =>
    keyA < keyB || (keyA === keyB && idA < idB);

const insertionPoint = (ids: ReadonlyArray<string>, key: number, id: string, keyOf: (id: string) => number) => {
    let low = 0;
    let high = ids.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        const other = ids[mid];
        if (before(keyOf(other), other, key, id)) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
};

export const insertSorted = (ids: Array<string>, id: string, key: number, keyOf: (id: string) => number): void => {
    const at = insertionPoint(ids, key, id, keyOf);
    for (let i = ids.length; i > at; i--) {
        ids[i] = ids[i - 1];
    }
    ids[at] = id;
};

export class SortedIds {
    private readonly ids: Array<string> = [];
    private readonly keys = new Map<string, number>();
    private frozen: ReadonlyArray<string> = [];
    private changed = false;

    private readonly keyOf = (id: string): number => this.keys.get(id) ?? 0;

    upsert(id: string, key: number): void {
        const old = this.keys.get(id);
        if (old === key) {
            return;
        }
        this.changed = true;
        if (old === undefined) {
            this.keys.set(id, key);
            insertSorted(this.ids, id, key, this.keyOf);
            return;
        }
        const ids = this.ids;
        let at = insertionPoint(ids, old, id, this.keyOf);
        this.keys.set(id, key);
        while (at > 0 && before(key, id, this.keyOf(ids[at - 1]), ids[at - 1])) {
            ids[at] = ids[at - 1];
            at -= 1;
        }
        while (at < ids.length - 1 && before(this.keyOf(ids[at + 1]), ids[at + 1], key, id)) {
            ids[at] = ids[at + 1];
            at += 1;
        }
        ids[at] = id;
    }

    freeze(): ReadonlyArray<string> {
        if (this.changed) {
            this.frozen = this.ids.slice();
            this.changed = false;
        }
        return this.frozen;
    }
}
