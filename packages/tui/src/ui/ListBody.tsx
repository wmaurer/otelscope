import { LineText, Placeholder } from "./Chrome.tsx";
import { WindowedList } from "./WindowedList.tsx";

import type { ListBody as Body } from "../model/listFrame.ts";
import type { ReactNode } from "react";

export const ListBody = (props: {
    readonly body: Body;
    readonly rows: number;
    readonly onPick: (key: string) => void;
}): ReactNode => {
    const { body } = props;
    return body._tag === "Message" ? (
        <Placeholder lines={body.lines} />
    ) : (
        <box flexGrow={1} flexDirection="column">
            <LineText line={body.header} />
            <WindowedList
                size={body.size}
                selected={body.selected}
                keyAt={body.keyAt}
                row={(index, selected) => <LineText line={body.line(index, selected)} />}
                height={props.rows}
                onPick={(key) => props.onPick(key)}
            />
        </box>
    );
};
