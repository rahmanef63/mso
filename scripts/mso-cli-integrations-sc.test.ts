import {execFileSync} from "node:child_process";
import path from "node:path";
import {describe,expect,it} from "vitest";
const harness=path.join(__dirname,"test-support/integrations-sc-harness.sh");
const run=(mode:string)=>execFileSync("bash",[harness,mode],{encoding:"utf8"});
describe("optional SI-Coder local migration bridge",()=>{
  it("detects the canonical SI-Coder CLI through its public version/export contract",()=>{expect(JSON.parse(run("probe"))).toMatchObject({available:true,producer:"si-coder",userCount:1,connectionCount:1,mode:"metadata"})});
  it("previews metadata-only Integration Bundle import without transporting credential values",()=>{const text=run("preview"),p=JSON.parse(text);expect(p).toMatchObject({producer:"si-coder",canApply:true});expect(text).not.toContain("synthetic-secret");expect(text).not.toContain("values");});
});
