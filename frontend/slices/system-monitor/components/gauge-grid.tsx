import type { SysStats } from "../lib/host";
import { CircularGauge } from "./circular-gauge";
import { fmtGiBPair } from "../lib/format";

// The four headline gauges. CPU/Memory/Disk are real (from sys.stats); GPU is a
// local mock walk since it isn't part of the SysStats contract.
export function GaugeGrid({ stats, gpu }: { stats: SysStats; gpu?: number }) {
  const memPct = (stats.mem.used / stats.mem.total) * 100;
  const diskPct = (stats.disk.used / stats.disk.total) * 100;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
      <CircularGauge
        label="CPU"
        pct={stats.cpu.pct}
        sub={`${stats.cpu.cores} vCPU`}
        accent="--mon-cpu"
      />
      <CircularGauge
        label="Memory"
        pct={memPct}
        sub={fmtGiBPair(stats.mem.used, stats.mem.total)}
        accent="--mon-mem"
      />
      <CircularGauge
        label="Disk"
        pct={diskPct}
        sub={fmtGiBPair(stats.disk.used, stats.disk.total)}
        accent="--mon-disk"
      />
      {gpu !== undefined && <CircularGauge
        label="GPU (demo)"
        pct={gpu}
        sub="render accel"
        accent="--mon-gpu"
      />}
    </div>
  );
}
