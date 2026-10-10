import { Number as Num, Option } from "effect";

const CONTEXT_ROWS = 2;

export interface Scroll {
    readonly offset: number;
    readonly key: string;
    readonly index: number;
}

export const initialScroll: Scroll = { offset: 0, key: "", index: -1 };

interface Framing {
    readonly count: number;
    readonly viewport: number;
    readonly selectedIndex: number;
    readonly selectedKey: string;
}

export const deriveScroll = (previous: Scroll, next: Framing): Scroll => {
    if (next.selectedIndex < 0) {
        return initialScroll;
    }
    const shift = previous.key === next.selectedKey && previous.index >= 0 ? next.selectedIndex - previous.index : 0;
    const context = Math.min(CONTEXT_ROWS, Math.floor((next.viewport - 1) / 2));
    const offset = Num.clamp(previous.offset + shift, {
        minimum: next.selectedIndex - (next.viewport - 1 - context),
        maximum: next.selectedIndex - context,
    });
    return {
        offset: Num.clamp(offset, { minimum: 0, maximum: Math.max(0, next.count - next.viewport) }),
        key: next.selectedKey,
        index: next.selectedIndex,
    };
};

export interface Wheel {
    readonly offset: number;
    readonly forKey: string;
}

export const wheeled = (from: number, scroll: Scroll, by: number, count: number, viewport: number): Wheel => ({
    offset: Num.clamp(from + by, { minimum: 0, maximum: Math.max(0, count - viewport) }),
    forKey: scroll.key,
});

export const visibleOffset = (derived: Scroll, wheel: Option.Option<Wheel>): number =>
    Option.match(
        Option.filter(wheel, (w) => w.forKey === derived.key),
        { onNone: () => derived.offset, onSome: (w) => w.offset },
    );
