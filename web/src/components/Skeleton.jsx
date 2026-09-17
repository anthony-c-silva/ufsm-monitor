import React from "react";

export function Skeleton({ w = "100%", h = 14, r = 6, style }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function SkeletonKpis({ n = 6 }) {
  return (
    <div className="grid kpis">
      {Array.from({ length: n }).map((_, i) => (
        <div className="card kpi" key={i}>
          <Skeleton w="55%" h={11} />
          <div style={{ marginTop: 10 }}><Skeleton w="45%" h={26} /></div>
          <div style={{ marginTop: 8 }}><Skeleton w="60%" h={11} /></div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }) {
  return (
    <div className="card">
      <div className="bd">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} style={{ display: "flex", gap: 16, padding: "8px 0" }}>
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} w={c === 0 ? "18%" : "16%"} h={12} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonBlock({ h = 300 }) {
  return (
    <div className="card">
      <div className="bd">
        <Skeleton w="100%" h={h} r={10} />
      </div>
    </div>
  );
}
