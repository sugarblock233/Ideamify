/** E5: version × route swimlane headers — screen-space overlay.
 *
 *  Column headers (research version names, 「未分配」 pseudo-column last) and
 *  row headers (top-level route names) are drawn like the overview layer:
 *  canvas px projected through React Flow's transform, at fixed screen size,
 *  subscribing to the transform store so pans/zooms rerender only this layer.
 */

import { useTransform } from "./OverviewLabels";
import type { SwimlaneGrid } from "../lib/layout";

export default function SwimlaneHeaders({ grid }: { grid: SwimlaneGrid }) {
  const tf = useTransform();
  return (
    <div className="swim-headers" data-testid="swimlane-headers">
      {grid.cols.map((c) => (
        <span
          key={c.key}
          className="swim-col"
          title={c.label}
          style={{ left: tf[0] + c.x * tf[2], top: tf[1] + (grid.minY - 40) * tf[2] }}
        >
          {c.label}
        </span>
      ))}
      {grid.rows.map((r) => (
        <span
          key={r.id}
          className="swim-row"
          title={r.title}
          style={{ left: tf[0] + (grid.minX - 216) * tf[2], top: tf[1] + r.y * tf[2] + 8 }}
        >
          {r.title}
        </span>
      ))}
    </div>
  );
}
