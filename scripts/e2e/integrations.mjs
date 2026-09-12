#!/usr/bin/env node
// Exercises the shared browser/embed manager using synthetic accounts; never production credentials.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
const html = execFileSync("bun", ["-e", 'import { integrationSetupPage } from "./lib/infra/setup-page"; console.log(integrationSetupPage().html)'], {encoding:"utf8"});
const users=[{id:"studio",label:"Studio",isDefault:true},{id:"personal",label:"Personal",isDefault:false}];
const fixture={id:"work",label:"Delivery GitHub",provider:"github",source:"direct",authMethod:"token",scope:"account",state:"verified",isDefault:true,fields:[{key:"apiKey",label:"API key",stored:true}],verifiedAt:Date.now(),sharedFrom:null};
const snapshot=user=>({version:2,user,users:users.map(row=>({...row,connectionCount:row.id==="studio"?1:0})),connections:user==="studio"?[fixture]:[],bindings:[]});
function manage(body){
 if(body.action==="user.create")users.push({id:body.user,label:body.label||body.user,isDefault:false});
 if(body.action==="user.rename"){const row=users.find(x=>x.id===body.user);if(row){row.id=body.target;row.label=body.label||body.target}}
 if(body.action==="user.duplicate")users.push({id:body.target,label:body.label||body.target,isDefault:false});
 if(body.action==="user.default")for(const row of users)row.isDefault=row.id===body.user;
 if(body.action==="user.delete"){const index=users.findIndex(x=>x.id===body.user);if(index>=0)users.splice(index,1)}
 return {ok:true,action:body.action};
}
const browser=await chromium.launch({...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),args:["--no-sandbox","--disable-dev-shm-usage"]});
let checks=0;
try{
 const page=await browser.newPage();
 const waitDelivery=async stage=>{try{await page.getByRole("heading",{name:"Delivery GitHub"}).waitFor({timeout:5000})}catch(error){console.error("Delivery GitHub missing at "+stage+"\n"+(await page.locator("body").innerText()).slice(0,2500));throw error}};
 const errors=[];page.on("pageerror",error=>errors.push(error.message));
 await page.route("https://mso.example.com/**",route=>{
  const url=new URL(route.request().url());
  if(url.pathname==="/integrations")return route.fulfill({contentType:"text/html",body:html});
  if(url.pathname==="/api/auth/me")return route.fulfill({json:{role:"owner"}});
  if(url.pathname==="/api/v1/integrations"&&route.request().method()==="GET")return route.fulfill({json:snapshot(url.searchParams.get("user")||users.find(row=>row.isDefault)?.id||users[0]?.id||null)});
  if(url.pathname==="/api/v1/integrations"){
   const body=route.request().postDataJSON();return route.fulfill({json:body.mode==="manage"?manage(body):{ok:true,detail:"Connected to GitHub"}});
  }
  return route.fulfill({status:404,json:{error:"unhandled_fixture"}});
 });
 await page.goto("https://mso.example.com/integrations");
 await waitDelivery("initial");
 assert.equal(await page.getByRole("combobox",{name:"Credential owner"}).count(),0,"credential owner must not use a native select popup");checks++;
 for(const width of [320,390,768,1440,1920]){
  await page.setViewportSize({width,height:900});
  for(const theme of ["light","dark"]){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"no document overflow at "+width+" "+theme);checks++;
   assert(await page.getByRole("button",{name:"Update credentials",exact:true}).isVisible());checks++;
   for(const action of ["Users","Routing","Transfer"])assert(await page.getByRole("button",{name:action,exact:true}).isVisible(),action+" must stay discoverable");checks++;
  }
 }
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole("button",{name:"Verify",exact:true}).click();
 await page.getByRole("status").filter({hasText:"Verified: Connected to GitHub"}).waitFor();checks++;
 assert(await page.getByRole("button",{name:"Remove",exact:true}).isVisible(),"stored credential fields expose per-field removal");checks++;
 await page.getByText("More",{exact:true}).click();await page.getByRole("button",{name:"Share",exact:true}).click();await page.getByRole("heading",{name:"Share Delivery GitHub"}).waitFor();assert(await page.getByRole("group",{name:"Target credential owner"}).getByRole("button").isVisible());assert(await page.getByRole("textbox",{name:"New alias label",exact:true}).isVisible());checks++;await page.getByRole("button",{name:"Cancel",exact:true}).click();
 const owner=page.getByRole("group",{name:"Credential owner"}).getByRole("button");await owner.focus();await owner.press("ArrowDown");await page.getByRole("option",{name:/Studio/}).waitFor();await page.getByRole("option",{name:/Studio/}).press("ArrowDown");await page.getByRole("option",{name:/Personal/}).press("Enter");
 await page.getByRole("button",{name:"Add GitHub account",exact:true}).waitFor();assert.equal(await page.getByRole("heading",{name:"Delivery GitHub"}).count(),0);checks++;
 await owner.click();await page.getByRole("option",{name:/Studio/}).click();await waitDelivery("after owner switch back to Studio");checks++;
 await page.getByRole("button",{name:"Users",exact:true}).click();await page.getByRole("textbox",{name:"New user ID",exact:true}).fill("client-a");await page.getByRole("textbox",{name:"Display label",exact:true}).fill("Client A");await page.getByRole("button",{name:"Create user",exact:true}).click();await page.getByRole("group",{name:"Credential owner"}).getByRole("button").filter({hasText:/Client A/}).waitFor();checks++;
 await page.getByRole("button",{name:"Users",exact:true}).click();await page.getByRole("textbox",{name:"Target user ID",exact:true}).fill("client-main");await page.getByRole("textbox",{name:"New display label",exact:true}).fill("Client Main");await page.getByRole("button",{name:"Rename user",exact:true}).click();await page.getByRole("group",{name:"Credential owner"}).getByRole("button").filter({hasText:/Client Main/}).waitFor();checks++;
 await page.getByRole("button",{name:"Users",exact:true}).click();await page.getByRole("textbox",{name:"Target user ID",exact:true}).fill("client-copy");await page.getByRole("textbox",{name:"New display label",exact:true}).fill("Client Copy");await page.getByRole("button",{name:"Duplicate user",exact:true}).click();await page.getByRole("group",{name:"Credential owner"}).getByRole("button").filter({hasText:/Client Copy/}).waitFor();checks++;
 await page.getByRole("button",{name:"Users",exact:true}).click();await page.getByRole("button",{name:"Delete user",exact:true}).click();await page.getByRole("textbox",{name:"Confirmation",exact:true}).fill("client-copy");await page.getByRole("button",{name:"Confirm",exact:true}).click();await page.getByRole("group",{name:"Credential owner"}).getByRole("button").waitFor();assert.equal(users.some(row=>row.id==="client-copy"),false);checks++;
 await owner.click();await page.getByRole("option",{name:/Studio/}).click();await waitDelivery("after user CRUD returns to Studio");
 await page.getByRole("button",{name:"Add GitHub account",exact:true}).count();
 await page.getByRole("searchbox",{name:"Search services"}).fill("cloudflare");assert.equal(await page.getByRole("navigation",{name:"Services"}).getByRole("button",{includeHidden:true}).count(),14);assert.equal(await page.getByRole("navigation",{name:"Services"}).getByRole("button").filter({visible:true}).count(),1);checks++;
 await page.getByRole("searchbox",{name:"Search services"}).fill("");
 assert.deepEqual(errors,[]);checks++;
 console.log("Integrations browser: "+checks+" checks passed (320–1920 px, light/dark, semantic owner picker, user CRUD, search, setup, verification).");
}finally{await browser.close()}
