// Telemetry formatters — shared via the shell barrel (a legal alias) so About,
// neofetch and the monitor all show the same numbers. Re-exported here to keep
// the slice's internal import paths stable; this file is the slice's only seam.
export {
  fmtGiB,
  toGiB,
  fmtGiBPair,
  fmtPct,
  fmtMBs,
  clampPct,
  fmtUptime,
} from "@/lib/os-api/format";
