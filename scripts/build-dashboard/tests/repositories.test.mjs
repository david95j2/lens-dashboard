import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {validateRepository} from '../repositories.mjs';
import {createDashboard,dashboardRoot,run} from '../server.mjs';
const git=(repo,args)=>run('git',args,{cwd:repo}).then(s=>s.trim());
async function fixture(root,name,version){
 const repo=path.join(root,name);
 await mkdir(path.join(repo,'src/SiriusLens.App'),{recursive:true});await mkdir(path.join(repo,'scripts'));
 await writeFile(path.join(repo,'src/SiriusLens.App/SiriusLens.App.csproj'),`<Project><PropertyGroup><Version>${version}</Version></PropertyGroup></Project>`);
 await writeFile(path.join(repo,'scripts/publish-protected.ps1'),'# Test fixture, not executable build logic');
 await git(repo,['init']);await git(repo,['add','.']);
 await git(repo,['-c','user.name=Dashboard Test','-c','user.email=test@example.invalid','commit','-m','fixture']);
 return repo;
}
test('repository linking validates root/product, persists settings and changes version query without altering history',async()=>{
 const root=await mkdtemp(path.join(dashboardRoot,'artifacts/repository-test-'));
 const old=await fixture(root,'old','1.0.2'),next=await fixture(root,'next','1.0.3');
 assert.equal((await validateRepository('lens',next,git)).version,'1.0.3');
 await assert.rejects(validateRepository('lens',path.join(next,'src'),git),/최상위/);
 await assert.rejects(validateRepository('installer',next,git),/LensInstaller/);
 await assert.rejects(validateRepository('lens','relative',git),/전체 경로/);
 const config={lensPath:old,installerPath:old,codexCommand:'codex.exe',notion:{productName:'SIRIUS LENS'},lensArchivePath:'D:/keep'};
 const configFile=path.join(root,'settings.json');await writeFile(configFile,JSON.stringify(config));
 const dataRoot=path.join(root,'data'),id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 await mkdir(path.join(dataRoot,id),{recursive:true});
 await writeFile(path.join(dataRoot,id,'job.json'),JSON.stringify({id,product:'lens',action:'build',status:'succeeded',startedAt:'2026-10-20'}));
 const {server}=await createDashboard({config,configFile,dataRoot});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const url=`http://127.0.0.1:${server.address().port}`,get=()=>fetch(url+'/api/state').then(r=>r.json());
  const state=await get();
  const post=(token,expectedPath)=>fetch(url+'/api/repository/link',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':token},body:JSON.stringify({product:'lens',path:next,expectedPath})});
  assert.equal((await post('wrong',old)).status,403);
  assert.equal((await post(state.token,'stale')).status,400);
  assert.equal((await post(state.token,old)).status,200);
  const updated=await get();assert.equal(updated.products[0].version,'1.0.3');assert.equal(updated.products[0].repo,next);
  assert.equal(updated.jobs[0].repo,old);
  assert.equal(JSON.parse(await readFile(path.join(dataRoot,id,'job.json'),'utf8')).repo,old);
  const saved=JSON.parse(await readFile(configFile,'utf8'));assert.equal(saved.lensPath,next);assert.equal(saved.lensArchivePath,'D:/keep');
 }finally{server.close();await once(server,'close');}
});
