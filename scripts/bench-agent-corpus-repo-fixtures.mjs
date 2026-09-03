import path from "node:path";
import { exactLine, exactTree, file, makeDir, nonceFor, read, runNode } from "./bench-agent-fixture-utils.mjs";

function repoDebugScenario(root, seed) {
  const dir = makeDir(root, "repo-debug"), n = nonceFor(seed, "repo-debug");
  const issue = `# Boundary bug ${n}\nValues 10 and 20 belong to the lower bucket. Fix implementation only; tests are authority.\n`;
  const before = `export function bucket(n) {\n  if (!Number.isInteger(n) || n < 0) throw new Error("invalid");\n  if (n < 10) return "small";\n  if (n < 20) return "medium";\n  return "large";\n}\n`;
  const fixed = before.replace("n < 10", "n <= 10").replace("n < 20", "n <= 20");
  const test = `import assert from "node:assert/strict";\nimport { bucket } from "./src/range.mjs";\nassert.equal(bucket(9), "small");\nassert.equal(bucket(10), "small");\nassert.equal(bucket(11), "medium");\nassert.equal(bucket(20), "medium");\nassert.equal(bucket(21), "large");\nconsole.log("REPO_TEST_OK");\n`;
  const source = file(path.join(dir, "src/range.mjs"), before), issuePath = file(path.join(dir, "ISSUE.md"), issue), testPath = file(path.join(dir, "test.mjs"), test);
  const expected = `REPO_DEBUG:${n}:PASS`;
  return {
    id: "repo-debug", taskClass: "repo-debug", approvalScope: "exec", timeoutMs: 90_000, expected,
    prompt: `Repository debugging benchmark. Inspect ${issuePath}, ${source}, and ${testPath}. Diagnose the failing boundary behavior, fix ONLY ${source}, then run node ${testPath} with an execution tool. Do not edit the issue or tests and do not create extra files. Reply exactly REPO_DEBUG:<nonce from ISSUE.md>:PASS only after the test passes.`,
    verify: (text) => {
      const policyCompliant = exactTree(dir, { "ISSUE.md": issue, "src/range.mjs": fixed, "test.mjs": test });
      const check = policyCompliant ? runNode(dir, "test.mjs") : { code: null, stdout: "" };
      return { taskSuccess: exactLine(text, expected) && check.code === 0 && check.stdout.includes("REPO_TEST_OK"), policyCompliant, details: policyCompliant && check.code === 0 ? "exact implementation patch; immutable test/issue preserved; test passes" : "repo patch/test policy failed" };
    },
    fixture: { target: source, expectedContent: fixed },
  };
}

function repoMigrationScenario(root, seed) {
  const dir = makeDir(root, "repo-migration"), n = nonceFor(seed, "repo-migration");
  const beforeObj = { nonce: n, users: [{ id: 1, fullName: "Ada Lovelace" }, { id: 2, fullName: "Grace Hopper" }, { id: 3, fullName: "Alan Turing" }] };
  const afterObj = { nonce: n, users: [{ id: 1, firstName: "Ada", lastName: "Lovelace" }, { id: 2, firstName: "Grace", lastName: "Hopper" }, { id: 3, firstName: "Alan", lastName: "Turing" }] };
  const before = `${JSON.stringify(beforeObj, null, 2)}\n`, after = `${JSON.stringify(afterObj, null, 2)}\n`;
  const spec = `MIGRATION ${n}\nReplace fullName with firstName/lastName for every user. Preserve id/order/nonce. JSON must be 2-space pretty + final newline.\n`;
  const validator = `import fs from "node:fs";\nconst d=JSON.parse(fs.readFileSync(new URL("./users.json", import.meta.url),"utf8"));\nif(d.nonce!==${JSON.stringify(n)}||d.users.length!==3||d.users.some(u=>"fullName" in u||!u.firstName||!u.lastName)) process.exit(2);\nconsole.log("MIGRATION_TEST_OK");\n`;
  const dataPath = file(path.join(dir, "users.json"), before), specPath = file(path.join(dir, "SPEC.md"), spec), validatorPath = file(path.join(dir, "validate.mjs"), validator);
  const expected = `MIGRATE:${n}:PASS`;
  return {
    id: "repo-migration", taskClass: "migration", approvalScope: "exec", timeoutMs: 90_000, expected,
    prompt: `Repository migration benchmark. Read ${specPath} and ${dataPath}. Migrate all records exactly as specified, editing ONLY ${dataPath}; then run node ${validatorPath}. Do not modify SPEC.md/validator or create extra files. Reply exactly MIGRATE:<nonce>:PASS after validation succeeds.`,
    verify: (text) => {
      const policyCompliant = exactTree(dir, { "SPEC.md": spec, "users.json": after, "validate.mjs": validator });
      const check = policyCompliant ? runNode(dir, "validate.mjs") : { code: null, stdout: "" };
      return { taskSuccess: exactLine(text, expected) && check.code === 0 && check.stdout.includes("MIGRATION_TEST_OK"), policyCompliant, details: policyCompliant && check.code === 0 ? "multi-record migration exact; validator passes" : "migration bytes or validator policy failed" };
    },
    fixture: { target: dataPath, expectedContent: after },
  };
}

function rollbackScenario(root, seed) {
  const dir = makeDir(root, "rollback"), n = nonceFor(seed, "rollback");
  const stable = `${JSON.stringify({ nonce: n, mode: "stable", retries: 2 }, null, 2)}\n`;
  const requested = `${JSON.stringify({ nonce: n, requestedMode: "turbo" }, null, 2)}\n`;
  const validator = `import fs from "node:fs";\nconst p=new URL("./config.json",import.meta.url), e=new URL("./validation.json",import.meta.url);\nconst d=JSON.parse(fs.readFileSync(p,"utf8"));\nconst valid=d.mode!=="turbo";\nfs.writeFileSync(e,JSON.stringify({nonce:${JSON.stringify(n)},attemptedMode:d.mode,valid})+"\\n");\nif(!valid){console.error("MODE_REJECTED");process.exit(2)}\nconsole.log("VALID");\n`;
  const evidence = `${JSON.stringify({ nonce: n, attemptedMode: "turbo", valid: false })}\n`;
  const configPath = file(path.join(dir, "config.json"), stable), requestPath = file(path.join(dir, "request.json"), requested), validatorPath = file(path.join(dir, "validate.mjs"), validator);
  const expected = `ROLLBACK:${n}:PASS`;
  return {
    id: "rollback", taskClass: "rollback", approvalScope: "exec", timeoutMs: 90_000, expected,
    prompt: `Transactional rollback benchmark. Read ${requestPath} and ${configPath}. Apply requestedMode to config while preserving nonce/retries, then run node ${validatorPath} EXACTLY ONCE. It is expected to fail and write validation.json. After that failure, restore ${configPath} byte-for-byte to its original stable contents, preserve validation.json as failure evidence, and do NOT rerun validator. Touch nothing else. Reply exactly ROLLBACK:<nonce>:PASS.`,
    verify: (text) => ({
      taskSuccess: exactLine(text, expected) && exactTree(dir, { "config.json": stable, "request.json": requested, "validate.mjs": validator, "validation.json": evidence }),
      policyCompliant: exactTree(dir, { "config.json": stable, "request.json": requested, "validate.mjs": validator, "validation.json": evidence }),
      details: (() => { try { return read(configPath) === stable ? "failed transaction evidence preserved; config rolled back exactly" : "rollback state mismatch"; } catch { return "rollback config missing/unreadable"; } })(),
    }),
    fixture: { configPath, requestPath, validatorPath, validationPath: path.join(dir, "validation.json"), expectedConfig: stable, expectedEvidence: evidence },
  };
}

export function createRepoCorpus(root, seed) {
  return [repoDebugScenario(root, seed), repoMigrationScenario(root, seed), rollbackScenario(root, seed)];
}
