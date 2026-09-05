import {execFileSync} from "node:child_process";
import {expect,it} from "vitest";
import path from "node:path";
const script=path.join(__dirname,"test-support/integrations-cli-harness.sh");
function run(args:string[]){return execFileSync("bash",[script,...args],{encoding:"utf8"});}
it("routes exact user/provider/connection through the native owner API",()=>{
  expect(run(["resolve","alice","convex-cloud","mimin-production"])).toContain("view=resolve&user=alice&provider=convex-cloud&connection=mimin-production");
  expect(JSON.parse(run(["verify","alice","convex-cloud","mimin-staging"]))).toMatchObject({mode:"execute",operation:"verify",user:"alice",provider:"convex-cloud",connection:"mimin-staging"});
  expect(JSON.parse(run(["create-connection","alice","github","work","composio","oauth2"]))).toMatchObject({mode:"manage",confirm:true,user:"alice",provider:"github",connection:"work",source:"composio",authMethod:"oauth2"});
});
it("does not print private setup links through a non-interactive caller",()=>{
  expect(()=>run(["setup","alice","github","work"])).toThrow();
});
it("requires explicit metadata mutation confirmation and carries folder context",()=>{
  expect(()=>run(["manage",JSON.stringify({action:"user.delete",user:"alice"})])).toThrow();
  expect(JSON.parse(run(["manage",JSON.stringify({action:"user.default",user:"alice",confirm:true})]))).toMatchObject({mode:"manage",confirm:true});
  expect(run(["which","/home/test/project"])).toContain("view=which&cwd=/home/test/project");
});

it("bare non-interactive integrations remains machine-safe and does not wait for a TTY",()=>{expect(run([])).toContain("view=snapshot")});
