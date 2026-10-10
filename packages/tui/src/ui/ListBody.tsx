import { LineText, Placeholder } from "./Chrome.tsx";
import { WindowedList } from "./WindowedList.tsx";

import type { ListBody as Body } from "../model/listFrame.ts";
import type { ReactNode } from "react";

export const ListBody = (props: {
    readonly body: Body;
    readonly rows: number;
    readonly onPick: (key: string) => void;
}): ReactNode =>
    props.body._tag === "Message" ? (
        <Placeholder lines={props.body.lines} />
    ) : (
        <box flexGrow={1} flexDirection="column">
            <LineText line={props.body.header} />
            <WindowedList
                size={props.body.size}
                selected={props.body.selected}
                keyAt={props.body.keyAt}
                line={props.body.line}
                height={props.rows}
                onPick={props.onPick}
            />
        </box>
    );
