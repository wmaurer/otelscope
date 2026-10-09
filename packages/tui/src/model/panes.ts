export interface Panes {
    /** The tree's share in percent, 25 to 80. */
    readonly split: number;
    /** The guides-and-name column in cells. */
    readonly nameColumn: number;
}

export const defaultPanes: Panes = { split: 50, nameColumn: 32 };
