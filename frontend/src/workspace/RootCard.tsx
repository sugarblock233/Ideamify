/** Virtual project root (SPEC 2.1): not a Node, never draggable, connects
 *  the top-level routes to the canvas edge. */

import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface RootData extends Record<string, unknown> {
  name: string;
  objective: string;
  revision: number;
}

export const RootCard = React.memo(function RootCard(props: NodeProps) {
  const d = props.data as RootData;
  return (
    <div className="rm-root">
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
      <div className="pname">{d.name}</div>
      <div className="pobj" title={d.objective}>{d.objective}</div>
      <div className="pobj" style={{ marginTop: 6, color: "#9fb0c3" }}>v{d.revision}</div>
    </div>
  );
});