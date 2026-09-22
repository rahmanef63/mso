import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(os.tmpdir(), "mso-workflow-data-table-"));
process.env.OS_AGENT_SESSIONS_DIR = dir;
const api = await import("./data-table-store");
afterAll(async () => { delete process.env.OS_AGENT_SESSIONS_DIR; await rm(dir, { recursive: true, force: true }); });

describe("workflow data tables", () => {
  it("creates an owner-private table and CRUDs bounded rows", async () => {
    const table = await api.createWorkflowDataTable("owner-a", "Contacts", ["name", "email"]);
    expect((await api.listWorkflowDataTables("owner-a"))[0]).toMatchObject({ id: table.id, rowCount: 0, columns: ["name", "email"] });
    expect(await api.listWorkflowDataTables("owner-b")).toEqual([]);

    const row = await api.upsertWorkflowDataTableRow("owner-a", table.id, undefined, { name: "Ada", email: "ada@example.test" });
    expect((await api.getWorkflowDataTable("owner-a", table.id)).rows[0]).toMatchObject({ id: row.id, values: { name: "Ada" } });
    await api.upsertWorkflowDataTableRow("owner-a", table.id, row.id, { name: "Ada Lovelace", email: "ada@example.test" });
    expect((await api.getWorkflowDataTable("owner-a", table.id)).rows[0]?.values.name).toBe("Ada Lovelace");
    expect((await api.deleteWorkflowDataTableRow("owner-a", table.id, row.id)).deleted).toBe(true);
    expect((await api.deleteWorkflowDataTable("owner-a", table.id)).deleted).toBe(true);
  });

  it("rejects unknown columns and invalid definitions", async () => {
    await expect(api.createWorkflowDataTable("owner-a", "", ["name"])).rejects.toThrow("name");
    const table = await api.createWorkflowDataTable("owner-a", "Safe", ["name"]);
    await expect(api.upsertWorkflowDataTableRow("owner-a", table.id, undefined, { token: "nope" })).rejects.toThrow("unknown column");
  });
});
