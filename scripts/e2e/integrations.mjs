#!/usr/bin/env node
// Exercises the shared browser/embed manager using synthetic accounts; never production credentials.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), "os-browser/node_modules/playwright"));
const html = execFileSync("bun", ["-e", 'import { integrationSetupPage } from "./lib/infra/setup-page"; console.log(integrationSetupPage().html)'], {encoding:"utf8"});
const users=[{id:"studio",label:"Studio",isDefault:true},{id:"personal",label:"Personal"}];
const fixture={id:"work",label:"Delivery GitHub",provider:"github",source:"direct",authMethod:"token",scope:"account",state:"verified",isDefault:true,fields:[{key:"apiKey",stored:true}],verifiedAt:Date.now()};
const snapshot=user=>({version:2,user,users,connections:user==="studio"?[fixture]:[],bindings:[]});
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
let checks=0;
try{
 const page=await browser.newPage();
 const errors=[];page.on("pageerror",error=>errors.push(error.message));
 await page.route("https://mso.rahmanef.com/**",route=>{
  const url=new URL(route.request().url());
  if(url.pathname==="/integrations")return route.fulfill({contentType:"text/html",body:html});
  if(url.pathname==="/api/auth/me")return route.fulfill({json:{role:"owner"}});
  if(url.pathname==="/api/v1/integrations"&&route.request().method()==="GET")return route.fulfill({json:snapshot(url.searchParams.get("user")||"studio")});
  if(url.pathname==="/api/v1/integrations")return route.fulfill({json:{ok:true,detail:"Connected to GitHub"}});
  return route.fulfill({status:404,json:{error:"unhandled_fixture"}});
 });
 await page.goto("https://mso.rahmanef.com/integrations");
 await page.getByRole("heading",{name:"Delivery GitHub"}).waitFor();
 for(const width of [320,390,768,1440,1920]){
  await page.setViewportSize({width,height:900});
  for(const theme of ["light","dark"]){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"no document overflow at "+width+" "+theme);checks++;
   assert(await page.getByRole("button",{name:"Update credentials",exact:true}).isVisible());checks++;
  }
 }
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole("button",{name:"Verify",exact:true}).click();
 await page.getByRole("status").filter({hasText:"Verified: Connected to GitHub"}).waitFor();checks++;
 await page.getByRole("combobox",{name:"Credential owner"}).selectOption("personal");
 await page.getByRole("button",{name:"Add GitHub account",exact:true}).waitFor();
 assert.equal(await page.getByRole("heading",{name:"Delivery GitHub"}).count(),0);checks++;
 await page.getByRole("button",{name:"Add GitHub account",exact:true}).click();
 assert(await page.getByRole("textbox",{name:"Connection label",exact:true}).evaluate(el=>el===document.activeElement));checks++;
 await page.getByRole("textbox",{name:"Connection label",exact:true}).fill("Personal delivery");
 await page.getByText("Connection identifier",{exact:true}).click();
 assert.equal(await page.getByRole("textbox",{name:"Connection ID",exact:true}).inputValue(),"personal-delivery");checks++;
 await page.getByRole("button",{name:"Cancel",exact:true}).click();
 await page.getByRole("searchbox",{name:"Search services"}).fill("cloudflare");
 assert.equal(await page.getByRole("navigation",{name:"Services"}).getByRole("button",{includeHidden:true}).count(),14);
 assert.equal(await page.getByRole("navigation",{name:"Services"}).getByRole("button").filter({visible:true}).count(),1);checks++;
 await page.getByRole("searchbox",{name:"Search services"}).fill("");
 await page.getByRole("combobox",{name:"Credential owner"}).selectOption("studio");
 await page.getByRole("heading",{name:"Delivery GitHub"}).waitFor();
 assert.deepEqual(errors,[]);checks++;
 console.log("Integrations browser: "+checks+" checks passed (320–1920 px, light/dark, owner isolation, search, setup, verification).");
}finally{await browser.close()}
