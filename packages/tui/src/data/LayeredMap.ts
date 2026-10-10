/**
 * A read-only map made of a large base and a small layer of newer values on top. A publish copies only the layer, and
 * folds it into a new base once it holds more than a quarter as many entries as the base: copying a 36k-entry `Map`
 * took 2.3 ms, most of a publish's `freeze`. It iterates in the order a `Map` would, updated keys in place.
 */
export class LayeredMap<K, V> implements ReadonlyMap<K, V> {
    private readonly base: ReadonlyMap<K, V>;
    private readonly layer: ReadonlyMap<K, V>;
    readonly size: number;

    private constructor(base: ReadonlyMap<K, V>, layer: ReadonlyMap<K, V>, size: number) {
        this.base = base;
        this.layer = layer;
        this.size = size;
    }

    static empty<K, V>(): LayeredMap<K, V> {
        return new LayeredMap(new Map(), new Map(), 0);
    }

    /** A map with `updates` set over this one's entries; this one is left as it is. */
    with(updates: ReadonlyArray<readonly [K, V]>): LayeredMap<K, V> {
        if (updates.length === 0) {
            return this;
        }
        // oxlint-disable-next-line effect-native/imperative-collection-build -- a copy-on-write layer: filling it is the design.
        const layer = new Map(this.layer);
        let size = this.size;
        for (const [key, value] of updates) {
            if (!this.base.has(key) && !layer.has(key)) {
                size += 1;
            }
            layer.set(key, value);
        }
        if (layer.size * 4 <= this.base.size) {
            return new LayeredMap(this.base, layer, size);
        }
        // oxlint-disable-next-line effect-native/imperative-collection-build -- folding the layer in: filling it is the design.
        const base = new Map(this.base);
        for (const [key, value] of layer) {
            base.set(key, value);
        }
        return new LayeredMap(base, new Map(), size);
    }

    get(key: K): V | undefined {
        const value = this.layer.get(key);
        return value === undefined ? this.base.get(key) : value;
    }

    has(key: K): boolean {
        return this.layer.has(key) || this.base.has(key);
    }

    *entries(): MapIterator<[K, V]> {
        for (const [key, value] of this.base) {
            yield [key, this.layer.get(key) ?? value];
        }
        for (const [key, value] of this.layer) {
            if (!this.base.has(key)) {
                yield [key, value];
            }
        }
    }

    *keys(): MapIterator<K> {
        for (const [key] of this.entries()) {
            yield key;
        }
    }

    *values(): MapIterator<V> {
        for (const [, value] of this.entries()) {
            yield value;
        }
    }

    forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void {
        for (const [key, value] of this.entries()) {
            callback(value, key, this);
        }
    }

    [Symbol.iterator](): MapIterator<[K, V]> {
        return this.entries();
    }
}
