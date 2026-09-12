/** Shared native/embedded Add MCP form; credentials only enter the existing private setup form. */
export const PROJECT_MCP_UI_SCRIPT = String.raw`
function mountProjectMcpForm(detail,bridge,snapshot,user,status,back,helpers){
  const {n,b,input}=helpers,project=input("Project id or path"),alias=input("Server alias"),url=input("HTTPS MCP endpoint");
  project.input.maxLength=url.input.maxLength=4096;alias.input.maxLength=64;url.input.type="url";
  const label=n("label","Private connection"),select=n("select");select.setAttribute("aria-label","Private connection");
  const publicOption=n("option","Public MCP (no credentials)");publicOption.value="";select.append(publicOption);
  for(const row of snapshot.connections.filter(c=>c.provider==="mcp"&&c.user===user&&c.source==="direct")){const option=n("option",row.label+" · "+row.id);option.value=row.id;select.append(option)}
  label.append(select);detail.replaceChildren(n("h2","Add MCP to project"),n("p","Choose the project and endpoint. A private connection keeps credentials out of project files."),project.label,alias.label,url.label,label);
  const save=b("Add MCP",async()=>{
    save.disabled=true;
    try{
      if(!project.input.value.trim()||!alias.input.value.trim()||!url.input.value.trim())throw new Error("Project, alias and endpoint are required.");
      const p=project.input.value.trim(),current=await bridge.projectMcp({action:"inspect",project:p});
      if(current.servers.some(s=>s.name===alias.input.value.trim()))throw new Error("This alias already exists. Choose a new alias or edit its binding with project_mcp_manage.");
      const result=await bridge.projectMcp({action:"upsert",project:p,server:alias.input.value.trim(),url:url.input.value.trim(),revision:current.revision,...(select.value?{user,connection:select.value}:{})});
      status.textContent="MCP added to "+result.project+". Discover its tools with project_mcp_tools.";back();
    }catch(e){status.textContent=e.message||"Could not add MCP."}finally{save.disabled=false}
  },"primary");
  detail.append(save,b("Cancel",back));project.input.focus();
}
`;
