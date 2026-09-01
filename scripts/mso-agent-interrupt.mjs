import process from "node:process";

export function makeAbortError(message = "MSO Agent turn interrupted") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error) {
  return Boolean(error && (error.name === "AbortError" || error.code === "ABORT_ERR"));
}

export class AgentInterruptManager {
  constructor({ output = process.stdout, colors = {}, now = () => Date.now(), forceWindowMs = 2000 } = {}) {
    this.output = output;
    this.C = colors;
    this.now = now;
    this.forceWindowMs = forceWindowMs;
    this.controller = null;
    this.lastInterruptAt = 0;
    this.exitRequested = false;
  }

  beginTurn() {
    const controller = new AbortController();
    this.controller = controller;
    this.lastInterruptAt = 0;
    return controller.signal;
  }

  endTurn(signal) {
    if (this.controller?.signal === signal) this.controller = null;
    this.lastInterruptAt = 0;
  }

  interruptCurrent() {
    if (!this.controller || this.controller.signal.aborted) return false;
    const C = this.C;
    this.lastInterruptAt = this.now();
    this.output.write(`\n${C.warn || ""}⚡ interrupting turn…${C.reset || ""}${C.dim || ""} Ctrl+C again to exit${C.reset || ""}\n`);
    this.controller.abort(makeAbortError());
    return true;
  }

  handleSigint() {
    const C = this.C;
    const now = this.now();
    if (this.controller) {
      if (!this.controller.signal.aborted) {
        this.interruptCurrent();
        return "interrupt";
      }
      if (now - this.lastInterruptAt <= this.forceWindowMs) {
        this.exitRequested = true;
        this.output.write(`\n${C.warn || ""}⚡ exiting MSO Agent…${C.reset || ""}\n`);
        return "exit";
      }
      this.lastInterruptAt = now;
      this.output.write(`\n${C.warn || ""}⚡ turn is still stopping…${C.reset || ""}${C.dim || ""} Ctrl+C again to exit${C.reset || ""}\n`);
      return "interrupt";
    }
    this.exitRequested = true;
    return "exit";
  }
}
