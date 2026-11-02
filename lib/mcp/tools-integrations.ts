import { GOOGLE_READ_OPERATIONS } from "@/lib/infra/google-api-catalog";
import { queryIntegrationAction, manageIntegrationAction, executeIntegrationAction } from "@/lib/infra/connection-dispatch";
import { INTEGRATION_ACTIONS } from "@/lib/infra/connection-manage";
import { SOURCES } from "@/lib/infra/identity";
import { type McpTool, S, mcpDirect } from "./tool-kit";
export const INTEGRATION_SELECTOR_SCHEMA={user:{type:"string",maxLength:64},connection:{type:"string",maxLength:64},cwd:{type:"string",maxLength:4096}};
const BASE={...INTEGRATION_SELECTOR_SCHEMA,provider:{type:"string",maxLength:64}};
const OUTPUT={type:"object",properties:{result:{type:"object"}},required:["result"],additionalProperties:false};
export const INTEGRATION_TOOLS:McpTool[]=[
  {name:"integration_query",title:"Inspect Connections",scope:"read",annotations:{readOnlyHint:true,idempotentHint:true,openWorldHint:false},
    description:"Read native MSO credential users, providers, named connections, source/auth guidance and directory resolution. Never returns keys. Before asking the user for a credential or creating new setup, inspect Integrations for the exact project/context and resolve the intended user/provider/connection. User profiles are credential owners, not device roles. Resolve before acting when multiple accounts or deployments exist. Native Google read-operation schemas are discoverable in view=catalog.",
    chatgptDescription:"Inspect connections.",
    inputSchema:S({...BASE,view:{type:"string",enum:["snapshot","variables","catalog","users","connections","which","resolve","request"]},source:{type:"string",enum:[...SOURCES]},authMethod:{type:"string",maxLength:64}}),outputSchema:OUTPUT,
    meta:{ui:{visibility:["model","app"]},"openai/widgetAccessible":true},run:async a=>({result:await queryIntegrationAction(a)}),
  },
  {name:"integration_manage",title:"Manage Integrations",scope:"write",annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},audit:{action:"infra.write",targetArg:"user"},limit:{key:"integration.manage",max:30,windowMs:60000},
    description:"Manage native credential users, directory bindings and named provider connections. Actions require confirm=true. Direct credential values are forbidden: use integration_setup_open with user/provider/connection. Composio authorization keeps only external IDs/status and returns its transient URL privately to the UI. Native Google connection.authorize returns an Owner-browser entrypoint without requiring Composio. Native MCP authorization stays provider-owned.",
    chatgptDescription:"Manage connections.",
    inputSchema:S({...BASE,action:{type:"string",enum:[...INTEGRATION_ACTIONS,"connection.authorize","connection.import-convex-cli"]},confirm:{type:"boolean",const:true},target:{type:"string",maxLength:64},targetConnection:{type:"string",maxLength:64},label:{type:"string",maxLength:120},path:{type:"string",maxLength:4096},source:{type:"string",enum:[...SOURCES]},authMethod:{type:"string",maxLength:64},copyCredentials:{type:"boolean",description:"Duplicate with credentials."},makeDefault:{type:"boolean"},key:{type:"string",maxLength:64},authConfigId:{type:"string",maxLength:64},brokerConnection:{type:"string",maxLength:64},createManaged:{type:"boolean"}},["action","confirm"]),outputSchema:OUTPUT,
    meta:{ui:{visibility:["model","app"]},"openai/widgetAccessible":true},
    run:async a=>{const out=await manageIntegrationAction(a);if("privateUrl" in out){const{privateUrl,...safe}=out;return mcpDirect([{type:"text",text:"Authorization link available in the private integration UI."}],false,{result:safe},{integrationAuthorization:{url:privateUrl}});}return{result:out};},
  },
  {name:"integration_execute",title:"Use Integration",scope:"exec",annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true},audit:{action:"infra.write",targetArg:"connection"},limit:{key:"integration.execute",max:30,windowMs:60000},
    description:"Execute using an explicit user/provider/named connection. Verify or inspect its route; bounded direct operations reject external backends. Composio tool execution requires an ACTIVE connected account and a toolkit-prefixed tool. Native-MCP returns the provider route without copying OAuth tokens. Native Google supports the bounded read operations listed in its catalog without Composio. Non-verification operations require confirm=true. No credentials in arguments.",
    chatgptDescription:"Use a named connection.",
    inputSchema:S({...BASE,operation:{type:"string",enum:["route","verify","dokploy.projects.list","dokploy.applications.list","dokploy.gitProviders.list","dokploy.github.repositories.list","dokploy.application.ensureGithub","dokploy.domain.ensure","dokploy.deployments.list","dokploy.deployment.logs","dokploy.git.recover","dokploy.application.deploy","dokploy.dockerfile","dokploy.application.publicEnv.upsert","dokploy.project.ensure","convex.customDomains.list","convex.customDomain.ensure","convex.canonical.get","convex.env.presence","convex.canonical.set","convex.project.deploy","convex.snapshot.import","cloudflare.zones.list","cloudflare.dns.upsert","hostinger.dns.upsert","hostinger.mail.orders.list","hostinger.mail.plan.get","hostinger.mail.list","hostinger.mail.logs.list","hostinger.mail.mutate","mcp.tools.list","mcp.tool","composio.tool","google.bind","google.disconnect","google.operations.list",...GOOGLE_READ_OPERATIONS.map(operation=>operation.name)]},confirm:{type:"boolean"},tool:{type:"string",maxLength:180},arguments:{type:"object",additionalProperties:true}},["user","provider","connection","operation"]),outputSchema:OUTPUT,
    meta:{ui:{visibility:["model","app"]},"openai/widgetAccessible":true},run:async a=>({result:await executeIntegrationAction(a)}),
  },
];
