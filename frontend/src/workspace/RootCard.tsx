/** Virtual project root (SPEC 2.1): not a Node, never draggable, connects
 *  the top-level routes to the canvas edge. */

import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useT } from "../lib/i18n";

export interface RootData extends Record<string, unknown> {
  name: string;
  objective: string;
  revision: number;
  /** B2: vertical tree — the source handle faces bottom instead of right */
  v?: boolean;
}

export const RootCard = React.memo(function RootCard(props: NodeProps) {
  const t = useT();
  const d = props.data as RootData;
  return (
    <div className="rm-root">
      <Handle type="source" position={d.v ? Position.Bottom : Position.Right} isConnectable={false} style={{ opacity: 0 }} />
      <div className="pname">{d.name}</div>
      <div className="pobj" title={d.objective}>{d.objective}</div>
      {/* 38：与界面其他处的「记录 #N」统一；科研版本是另一套 v1/v2/v3 语义 */}
      <div className="pobj" style={{ marginTop: 6, color: "#9fb0c3" }}>{t("root.record", { n: d.revision })}</div>
    </div>
  );
});
