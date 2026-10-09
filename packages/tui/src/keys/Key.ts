/** The fields of OpenTUI's `KeyEvent` that dispatch reads; a `KeyEvent` satisfies it as it is. */
export interface KeyPress {
    readonly name: string;
    readonly sequence: string;
    readonly ctrl: boolean;
    readonly meta: boolean;
    readonly shift: boolean;
}

/** Every character the v1 keymap binds, so a typo in the binding table fails to compile. */
export type Char =
    | "/"
    | "?"
    | "!"
    | "q"
    | "j"
    | "k"
    | "g"
    | "G"
    | "n"
    | "N"
    | "S"
    | "r"
    | "1"
    | "2"
    | "3"
    | "-"
    | "+"
    | "="
    | "<"
    | ">"
    | "s"
    | "b"
    | "e"
    | "h"
    | "l"
    | "o"
    | "E"
    | "C"
    | "w"
    | "y";

export type Named =
    | "return"
    | "escape"
    | "space"
    | "tab"
    | "shift+tab"
    | "up"
    | "down"
    | "left"
    | "right"
    | "pageup"
    | "pagedown"
    | "home"
    | "end";

export type Ctrl = "ctrl+c" | "ctrl+d" | "ctrl+u" | "ctrl+z";

export type Key = Char | Named | Ctrl;

const named: ReadonlySet<string> = new Set<Named>([
    "return",
    "escape",
    "space",
    "tab",
    "up",
    "down",
    "left",
    "right",
    "pageup",
    "pagedown",
    "home",
    "end",
]);

const printable = (sequence: string): boolean => sequence.length === 1 && sequence >= " " && sequence !== "\u007f";

/**
 * The key a press means, comparable with `Key`. A printable key is the character received, so `?`, `+` and `<` work
 * on any keyboard layout. A press no binding holds gives a string no `Key` equals.
 */
export const normalize = (press: KeyPress): string => {
    if (press.meta) {
        return `meta+${press.sequence || press.name}`;
    }
    if (press.ctrl) {
        return `ctrl+${press.name}`;
    }
    if (press.name === "tab" && press.shift) {
        return "shift+tab";
    }
    if (press.name === "linefeed") {
        return "return";
    }
    if (named.has(press.name)) {
        return press.name;
    }
    return printable(press.sequence) ? press.sequence : press.name;
};

const labels = {
    return: "⏎",
    escape: "Esc",
    space: "Space",
    tab: "Tab",
    "shift+tab": "Shift-Tab",
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
    pageup: "PgUp",
    pagedown: "PgDn",
    home: "Home",
    end: "End",
    "ctrl+c": "Ctrl-c",
    "ctrl+d": "Ctrl-d",
    "ctrl+u": "Ctrl-u",
    "ctrl+z": "Ctrl-z",
} satisfies Readonly<Record<Named | Ctrl, string>>;

const isChar = (key: Key): key is Char => !(key in labels);

export const keyLabel = (key: Key): string => (isChar(key) ? key : labels[key]);
