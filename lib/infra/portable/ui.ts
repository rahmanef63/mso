// Bundled independent implementation of the versioned transfer UI.
export const PORTABILITY_SCRIPT=String.raw`
function mountPortability(root,bridge){
  let disposed=false,documentData=null,preview=null;root.replaceChildren();root.classList.add('integration','portable-transfer');
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};
  const button=(text,fn)=>{const b=el('button',text);b.type='button';b.addEventListener('click',fn);return b};
  const field=(name,type='text')=>{const l=el('label',name),i=el('input');i.type=type;i.autocomplete='off';if(type==='checkbox')l.className='check identity-check';l.append(i);return{l,i}};
  const back=button('← Connections',()=>{cleanup();bridge.back()});root.append(back,el('h2','Import / export JSON'),el('p','Move credential users and named connections between independent applications. This is a one-time copy, not live synchronization. No existing connection is overwritten.'));
  const exp=el('section'),imp=el('section');exp.className=imp.className='connection-card';exp.append(el('h3','Export'));
  const owner=field('User ID (blank exports all users)'),secrets=field('Include direct credentials — encrypted JSON','checkbox'),password=field('Export passphrase (12+ characters)','password'),repeat=field('Confirm export passphrase','password');
  password.i.maxLength=repeat.i.maxLength=1024;password.l.hidden=repeat.l.hidden=true;
  secrets.i.addEventListener('change',()=>{password.l.hidden=repeat.l.hidden=!secrets.i.checked;if(!secrets.i.checked)password.i.value=repeat.i.value=''});
  const note=el('p','Metadata export includes names, source/auth methods and field status only. All field values, active OAuth sessions, defaults and folder mappings are excluded.');
  const exportStatus=el('p');exportStatus.setAttribute('role','status');
  const download=button('Export JSON',async()=>{
    download.disabled=true;exportStatus.textContent='Preparing export…';
    try{if(secrets.i.checked&&(password.i.value.length<12||password.i.value!==repeat.i.value))throw Error('Use a matching passphrase of at least 12 characters.');
      const response=await bridge.request({action:'export',...(owner.i.value.trim()?{users:[owner.i.value.trim()]}:{}),includeSecrets:secrets.i.checked,...(secrets.i.checked?{passphrase:password.i.value}:{})});
      if(disposed)return;const encrypted=response.bundle.format.endsWith('.encrypted');
      const blob=new Blob([JSON.stringify(response.bundle,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a','Save JSON file');
      a.href=url;a.download='connections-'+new Date().toISOString().slice(0,10)+(encrypted?'.integration-bundle.enc.json':'.integration-bundle.json');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      exportStatus.textContent=encrypted?'Encrypted export created. Share the passphrase through a separate channel.':'Metadata export created. It contains no credential values.';
    }catch(e){exportStatus.textContent=e.message}finally{password.i.value=repeat.i.value='';download.disabled=false}
  });exp.append(owner.l,secrets.l,password.l,repeat.l,note,download,exportStatus);
  imp.append(el('h3','Import'));const file=field('JSON bundle file','file');file.i.accept='.json,application/json';
  const decrypt=field('Import passphrase (encrypted files only)','password'),prefix=field('User ID prefix (optional, for a separate copy)'),policy=el('select'),policyLabel=el('label','Conflicts');
  decrypt.i.maxLength=1024;prefix.i.placeholder='imported-';prefix.i.maxLength=32;decrypt.l.hidden=true;
  for(const [value,text]of [['skip','Preserve existing connections; skip conflicts'],['error','Stop when a conflict exists']]){const o=el('option',text);o.value=value;policy.append(o)}policyLabel.append(policy);
  const previewBox=el('pre');previewBox.style.whiteSpace='pre-wrap';previewBox.style.overflowWrap='anywhere';const importStatus=el('p');importStatus.setAttribute('role','status');
  const reviewed=field('I reviewed the preview and accept listed skips / omitted fields','checkbox');reviewed.i.checked=false;
  function reset(){preview=null;previewBox.textContent='';apply.disabled=true;reviewed.i.checked=false;}
  file.i.addEventListener('change',async()=>{reset();documentData=null;decrypt.i.value='';const selected=file.i.files?.[0];if(!selected)return;try{if(selected.size>2*1024*1024)throw Error('JSON file exceeds 2 MiB.');documentData=JSON.parse(await selected.text());decrypt.l.hidden=documentData.format!=='integration-bundle.encrypted';importStatus.textContent='File loaded locally. Choose Preview import.'}catch(e){importStatus.textContent=e.message}});
  prefix.i.addEventListener('input',reset);policy.addEventListener('change',reset);
  const input=()=>({action:'import',document:documentData,prefix:prefix.i.value.trim(),policy:policy.value,...(!decrypt.l.hidden?{passphrase:decrypt.i.value}:{})});
  const check=button('Preview import',async()=>{if(!documentData){importStatus.textContent='Choose a JSON file first.';return}check.disabled=true;try{preview=await bridge.request(input());if(disposed)return;previewBox.textContent=JSON.stringify(preview,null,2);apply.disabled=!preview.canApply;importStatus.textContent='Preview only: nothing has been imported.'}catch(e){reset();importStatus.textContent=e.message}finally{check.disabled=false}});
  const apply=button('Apply import',async()=>{
    if(!preview||!reviewed.i.checked){importStatus.textContent='Review the preview and check the confirmation box.';return}apply.disabled=check.disabled=true;
    try{const result=await bridge.request({...input(),apply:true,confirm:preview.planId,acceptWarnings:reviewed.i.checked});if(disposed)return;previewBox.textContent=JSON.stringify(result,null,2);importStatus.textContent='Imported. Connections are not marked verified; external sources must be authorized again. Select the imported user when you return.';documentData=null;file.i.value='';decrypt.i.value='';preview=null;}
    catch(e){importStatus.textContent=e.message;apply.disabled=false}finally{check.disabled=false}
  });apply.disabled=true;
  imp.append(file.l,decrypt.l,prefix.l,policyLabel,check,previewBox,reviewed.l,apply,importStatus);const grid=el('div');grid.className='transfer-grid';grid.append(exp,imp);root.append(grid);
  function cleanup(){disposed=true;password.i.value=repeat.i.value=decrypt.i.value='';documentData=null;preview=null;root.replaceChildren();root.classList.remove('portable-transfer','integration')}
  return cleanup;
}
`;
export const PORTABILITY_STYLE=String.raw`
.portable-transfer{max-width:1100px!important;margin:auto}.portable-transfer .transfer-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}.portable-transfer section{min-width:0;border:1px solid var(--sep-strong,var(--line,#ddd));border-radius:12px;padding:20px;background:var(--field,var(--panel,#fff))}.portable-transfer h3{margin-top:0}.portable-transfer label{display:block;margin:14px 0 6px;font-weight:600;font-size:13px}.portable-transfer input,.portable-transfer select{margin-top:6px;min-width:0;max-width:100%}.portable-transfer .identity-check{display:flex;gap:9px;align-items:center;font-weight:400}.portable-transfer .identity-check input{width:18px;height:18px;margin:0;order:-1;flex:none}.portable-transfer button{min-height:40px;margin:8px 7px 8px 0}.portable-transfer pre{max-height:330px;overflow:auto;font-size:12px;line-height:1.6}.portable-transfer [role=status]{font-size:13px;overflow-wrap:anywhere}@media(max-width:700px){.portable-transfer .transfer-grid{grid-template-columns:1fr}.portable-transfer section{padding:15px}}
`;
