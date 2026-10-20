import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createDashboard, lensRoot, dashboardRoot, run, productState } from '../server.mjs';
import { validVersion, isUpgrade, makePrompt } from '../workflow.mjs';

test('job logs and folder opening report success, missing jobs and launcher errors',async()=>{
  const dataRoot=await mkdtemp(path.join(dashboardRoot,'artifacts/dashboard-open-test-'));
  let opened, fail=false;
  const {server,jobs}=await createDashboard({dataRoot,inspect:async id=>({id}),
    open:async folder=>{opened=folder;if(fail)throw Object.assign(new Error('launch failed'),{code:'EACCES'});}});
  jobs.push({id:'fixture',status:'succeeded',log:'build complete',summary:'완료'});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const url=`http://127.0.0.1:${server.address().port}`;
    const state=await(await fetch(url+'/api/state')).json();
    assert.equal((await(await fetch(url+'/api/log?id=fixture')).json()).log,'build complete');
    assert.equal((await fetch(url+'/api/log?id=missing')).status,404);
    const post=id=>fetch(url+'/api/open',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':state.token},body:JSON.stringify({id})});
    assert.equal((await post('fixture')).status,200);
    assert.equal(opened,path.join(dataRoot,'fixture'));
    fail=true;
    const failed=await post('fixture');
    assert.equal(failed.status,400);assert.match((await failed.json()).error,/EACCES/);
    assert.equal((await post('missing')).status,400);
  }finally{server.close();await once(server,'close');}
});

test('semantic upgrades reject same, older and command-like values',()=>{
  assert.ok(validVersion('1.0.3'));assert.ok(isUpgrade('1.10.0','1.9.9'));
  for(const value of ['1.0.2','1.0.1','01.1.3','1.2.3; whoami','1.2','x'])assert.equal(isUpgrade(value,'1.0.2'),false);
});
test('agent error produces a failed job without inventing a commit or Notion success',async()=>{
  const dataRoot=await mkdtemp(path.join(dashboardRoot,'artifacts/dashboard-agent-test-'));
  const config={installerPath:lensRoot,codexCommand:'codex.exe',notion:{productName:'SIRIUS LENS'}};
  let received;
  const execute=async(command,args,options)=>{
    assert.equal(command,'codex.exe');received=options.input;
    assert.ok(args.includes('--approve-for-me'));
    assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
    throw new Error('Notion authentication required');
  };
  const {server,jobs}=await createDashboard({config,dataRoot,execute});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const state=await(await fetch(url+'/api/state')).json();
    // The test is valid for clean and dirty checkouts; use sync with an explicitly persisted known commit.
    jobs.push({id:'fixture',commit:state.products[0].head,product:'lens',options:{},startedAt:new Date().toISOString(),status:'partial'});
    const response=await fetch(url+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':state.token},body:JSON.stringify({product:'lens',action:'sync',jobId:'fixture'})});
    assert.equal(response.status,202);
    for(let i=0;i<100&&jobs[0].status==='running';i++)await new Promise(r=>setTimeout(r,25));
    assert.equal(jobs[0].status,'partial');assert.equal(jobs[0].commit,state.products[0].head);
    assert.match(jobs[0].summary,/authentication required/);assert.equal(jobs[0].taskUrl,undefined);
    assert.match(received,/NOTION RETRY ONLY/);
  }finally{server.close();await once(server,'close');}
});
test('retry prompt authorizes only Notion recovery, retaining the commit key',()=>{
  const prompt=makePrompt({id:'retry',originJob:'original',action:'sync',existingCommit:'a'.repeat(40),options:{},product:'lens'}, {notion:{productName:'SIRIUS LENS'}},lensRoot);
  assert.ok(prompt.includes('NOTION RETRY ONLY'));assert.ok(prompt.includes('Do not modify files or commit'));
  assert.ok(prompt.includes('Dashboard job: original'));assert.ok(prompt.includes('never duplicate on retry'));
});

test('installer reuses LENS version independently of its binary version',()=>{
  const prompt=makePrompt({id:'installer',action:'version',product:'installer',currentVersion:'1.0.0',
    notionVersion:'1.0.2',options:{version:'1.0.1'}},{notion:{productName:'SIRIUS LENS'}},lensRoot);
  assert.match(prompt,/Target Notion version: 1.0.2/);
  assert.match(prompt,/EXISTING SIRIUS LENS/);
  assert.match(prompt,/Never create an Installer version record/);
  assert.match(prompt,/Set version to 1.0.1/);
});

test('installer job snapshots LENS relationship and passes selected model without changing global settings',async()=>{
  const dataRoot=await mkdtemp(path.join(dashboardRoot,'artifacts/dashboard-model-test-'));
  const config={installerPath:lensRoot,codexCommand:'codex.exe',notion:{productName:'SIRIUS LENS'}};
  let received;
  const {server,jobs}=await createDashboard({config,dataRoot,
    inspect:async id=>({...await productState('lens',config),id,version:id==='lens'?'1.0.2':'1.0.0',changes:' M example.cs'}),
    execute:async(command,args)=>{received=args;throw new Error('mock stop');}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const url=`http://127.0.0.1:${server.address().port}`;
    const state=await(await fetch(url+'/api/state')).json();
    const post=body=>fetch(url+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':state.token},body:JSON.stringify(body)});
    assert.equal((await post({product:'installer',action:'commit',model:'bad --flag'})).status,400);
    assert.equal((await post({product:'installer',action:'commit',effort:'invalid'})).status,400);
    assert.equal((await post({product:'installer',action:'commit',model:'test-model',effort:'medium'})).status,202);
    for(let i=0;i<100&&jobs[0].status==='running';i++)await new Promise(r=>setTimeout(r,25));
    assert.equal(jobs[0].notionVersion,'1.0.2');
    assert.equal(jobs[0].currentVersion,'1.0.0');
    assert.equal(received[received.indexOf('--model')+1],'test-model');
    assert.ok(received.includes('model_reasoning_effort="medium"'));
    assert.equal(jobs[0].status,'failed');
  }finally{server.close();await once(server,'close');}
});
test('runner reports process failure and accepts stdin without a shell',async()=>{
  assert.equal(await run(process.execPath,['-e','process.stdin.on("data",d=>process.stdout.write(d))'],{input:'a; $() & b'}),'a; $() & b');
  await assert.rejects(run(process.execPath,['-e','process.exit(17)']),/17/);
});
test('HTTP origin/token guards, one-job locking, persisted build output and failure handling',async()=>{
  const dataRoot=await mkdtemp(path.join(dashboardRoot,'artifacts/dashboard-test-'));
  const config={installerPath:lensRoot,signingKeyAlias:'test',codexCommand:'codex.exe',notion:{}};
  let finish;
  const execute=async(command,args)=>{
    assert.equal(command,'powershell.exe');
    await new Promise(resolve=>finish=resolve);
    const folder=args[args.indexOf('-OutputRoot')+1], result=path.join(folder,'test.zip');
    await writeFile(result,'fixture');return `RESULT: ${result}\n`;
  };
  let publishedMetadata;
  const {server,jobs}=await createDashboard({config,dataRoot,execute,
    inspect:()=>productState('lens',config),
    promote:async(repo,folder,result,metadata)=>{publishedMetadata=metadata;return result;}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const state=await (await fetch(url+'/api/state')).json();
    assert.ok(validVersion(state.products[0].version));
    assert.equal(state.releases[0].version,'1.0.2');
    assert.equal(state.releases[0].referenceCommit,'d354583c92630155a38190b158d82258a93167b2');
    const logo=await fetch(url+'/branding/sirius.svg');
    assert.equal(logo.status,200);assert.match(logo.headers.get('content-type'),/image\/svg\+xml/);
    const icon=await fetch(url+'/branding/lens.png');
    assert.equal(icon.status,200);assert.match(icon.headers.get('content-type'),/image\/png/);
    assert.equal((await fetch(url+'/branding/settings.json')).status,404);
    const post=(body,extra={})=>fetch(url+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':state.token,...extra},body:JSON.stringify(body)});
    assert.equal((await post({product:'lens',action:'build'},{Origin:'https://evil.example'})).status,403);
    assert.equal((await post({product:'lens',action:'build'},{'X-Dashboard-Token':'bad'})).status,403);
    assert.equal((await post({product:'lens',action:'shell'})).status,400);
    assert.equal((await post({product:'lens',action:'version',version:'0.1.0'})).status,400);
    const responses=await Promise.all([post({product:'lens',action:'build'}),post({product:'lens',action:'build'})]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[202,400]);
    while(!finish)await new Promise(r=>setTimeout(r,20));finish();
    for(let i=0;i<100&&jobs[0].status==='running';i++)await new Promise(r=>setTimeout(r,30));
    assert.equal(jobs[0].status,'succeeded',jobs[0].summary);
    assert.ok(jobs[0].output.endsWith('test.zip'));
    assert.equal(publishedMetadata.commit,state.products[0].head);
    assert.equal(publishedMetadata.version,state.products[0].version);
    assert.equal(publishedMetadata.sourceDirty,!!state.products[0].changes);
    const after=await(await fetch(url+'/api/state')).json();
    assert.equal(after.builds[0].baseHead,state.products[0].head);
    assert.equal(after.builds[0].currentVersion,state.products[0].version);
    const recovered=await createDashboard({config,dataRoot,execute});
    assert.equal(recovered.jobs[0].status,'succeeded');
    assert.equal((await fetch(url+'/../settings.json')).status,404);
  }finally{server.close();await once(server,'close');}
});
