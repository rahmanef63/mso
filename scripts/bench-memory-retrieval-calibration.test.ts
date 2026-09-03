import { describe, expect, it } from "vitest";
import { runMemoryRetrievalCalibration } from "./bench-memory-retrieval-calibration.mjs";

describe("P10D memory retrieval evidence gate", () => {
  it("compares the existing local semantic encoder against lexical retrieval without adding a memory vector index", () => {
    const result = runMemoryRetrievalCalibration();
    expect(result.retrieval.passed).toBe(4);
    expect(result.retrieval.total).toBe(6);
    expect(result.semanticCandidate.encoder).toBe("mso-local-hybrid-v1");
    expect(result.semanticCandidate.passed).toBe(3);
    expect(result.semanticCandidate.total).toBe(6);
    expect(result.semanticCandidate.deltaPassedVsLexical).toBe(-1);
    expect(result.semanticCandidate.networkCalls).toBe(0);
    expect(result.semanticCandidate.persistedMemoryVectors).toBe(0);
    expect(result.semanticEvidenceGate.candidateImprovesRecall).toBe(false);
    expect(result.semanticEvidenceGate.vectorLayerRequired).toBe(false);
    expect(result.graph.passed).toBe(3);
    expect(result.graph.total).toBe(3);
    expect(result.graph.graphStorageRequired).toBe(false);
  });
});
