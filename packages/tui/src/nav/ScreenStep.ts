import { Option } from "effect";

import type { Snapshot } from "../data/Snapshot.ts";
import type { ScreenList } from "../model/screenList.ts";
import type { Nav } from "./Nav.ts";

export interface StepContext {
    readonly snapshot: Snapshot;
    readonly list: ScreenList;
    readonly listRows: number;
}

export interface ScreenStep {
    readonly nav: Nav;
    readonly say: Option.Option<string>;
}

export const stepTo = (nav: Nav): ScreenStep => ({ nav, say: Option.none() });
