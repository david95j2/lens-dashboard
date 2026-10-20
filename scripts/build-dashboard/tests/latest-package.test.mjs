import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {dashboardRoot as lensRoot} from '../server.mjs';
import {promoteLensPackage} from '../latest-package.mjs';

async function fixture(){
  const repo=await mkdtemp(path.join(lensRoot,'artifacts/dashboard-publish-test-'));
  async function job(name,content){
    const dir=path.join(repo,'artifacts/dashboard',name);
    await mkdir(path.join(dir,'SiriusLens'),{recursive:true});
    await writeFile(path.join(dir,'SiriusLens/SiriusLens.App.exe'),content);
    await writeFile(path.join(dir,'SiriusLens.zip'),content);
    await writeFile(path.join(dir,'package.json'),'\uFEFF{"Version":"1.0.3","RealUiValidated":false}');
    return dir;
  }
  return {repo,job};
}
test('latest output replaces the complete folder without archiving old or duplicate binaries',async()=>{
  const {repo,job}=await fixture();
  const first=await job('one','first');
  await writeFile(path.join(first,'SiriusLens/obsolete.dll'),'old');
  await promoteLensPackage(repo,first,path.join(first,'SiriusLens.zip'),{jobId:'one',commit:'a'.repeat(40),version:'1.0.3'});
  const second=await job('two','second');
  const result=await promoteLensPackage(repo,second,path.join(second,'SiriusLens.zip'),{jobId:'two',commit:'b'.repeat(40),version:'1.0.4',sourceDirty:true});
  assert.equal(result,path.join(repo,'publish/SiriusLens.zip'));
  assert.equal(await readFile(result,'utf8'),'second');
  await assert.rejects(access(path.join(repo,'publish/SiriusLens/obsolete.dll')));
  await assert.rejects(access(path.join(second,'previous-publish')));
  await assert.rejects(access(path.join(first,'SiriusLens')));
  await assert.rejects(access(path.join(second,'SiriusLens.zip')));
  const info=JSON.parse(await readFile(path.join(repo,'publish/build-info.json'),'utf8'));
  assert.equal(info.commit,'b'.repeat(40));assert.equal(info.version,'1.0.4');assert.equal(info.sourceDirty,true);
});
test('failed preparation preserves the current published output',async()=>{
  const {repo,job}=await fixture(),first=await job('one','first');
  await promoteLensPackage(repo,first,path.join(first,'SiriusLens.zip'),{jobId:'one'});
  const bad=await job('bad','bad');
  await assert.rejects(promoteLensPackage(repo,bad,path.join(bad,'missing.zip'),{jobId:'bad'}));
  assert.equal(await readFile(path.join(repo,'publish/SiriusLens.zip'),'utf8'),'first');
});
test('successful promotion cleans only its own protected build run',async()=>{
  const {repo,job}=await fixture(),source=await job('one','first');
  const run=path.join(repo,'artifacts/protection/current');
  const other=path.join(repo,'artifacts/protection/other');
  await mkdir(path.join(run,'unsigned-candidate'),{recursive:true});
  await mkdir(other,{recursive:true});
  await writeFile(path.join(source,'package.json'),JSON.stringify({SourceCandidate:path.join(run,'unsigned-candidate')}));
  await promoteLensPackage(repo,source,path.join(source,'SiriusLens.zip'),{jobId:'one'});
  await assert.rejects(access(run));
  await access(other);
  assert.equal(await readFile(path.join(repo,'publish/SiriusLens.zip'),'utf8'),'first');
});
test('archives every LENS release separately while keeping only latest publish on C',async()=>{
  const {repo,job}=await fixture(),archive=path.join(repo,'test-archive');
  for(const name of ['one','two']){
    const source=await job(name,name);
    await promoteLensPackage(repo,source,path.join(source,'SiriusLens.zip'),{jobId:name},archive);
    assert.equal(await readFile(path.join(archive,name,'SiriusLens.zip'),'utf8'),name);
    await assert.rejects(access(path.join(source,'SiriusLens')));
  }
  assert.equal(await readFile(path.join(repo,'publish/SiriusLens.zip'),'utf8'),'two');
  assert.equal(await readFile(path.join(archive,'one/SiriusLens.zip'),'utf8'),'one');
});
test('unavailable archive destination preserves the existing release and new source',async()=>{
  const {repo,job}=await fixture(),first=await job('one','first');
  await promoteLensPackage(repo,first,path.join(first,'SiriusLens.zip'),{jobId:'one'});
  const second=await job('two','second'),blocked=path.join(repo,'blocked');
  await writeFile(blocked,'not a directory');
  await assert.rejects(promoteLensPackage(repo,second,path.join(second,'SiriusLens.zip'),{jobId:'two'},blocked));
  assert.equal(await readFile(path.join(repo,'publish/SiriusLens.zip'),'utf8'),'first');
  await access(path.join(second,'SiriusLens.zip'));
});
test('unmanaged publish folder and escaping sources cannot be overwritten',async()=>{
  const {repo,job}=await fixture(),source=await job('one','first');
  await mkdir(path.join(repo,'publish'));await writeFile(path.join(repo,'publish/user.txt'),'keep');
  await assert.rejects(promoteLensPackage(repo,source,path.join(source,'SiriusLens.zip'),{jobId:'one'}),/대시보드가 생성한/);
  assert.equal(await readFile(path.join(repo,'publish/user.txt'),'utf8'),'keep');
  await assert.rejects(promoteLensPackage(repo,path.dirname(repo),path.join(repo,'bad.zip'),{}),/Invalid package/);
});
test('separate dashboard workspace is allowed only through its explicit data root',async()=>{
  const {repo,job}=await fixture();
  const source=await job('source','package');
  const productRepo=path.join(repo,'separate-product');
  await mkdir(productRepo);
  await assert.rejects(promoteLensPackage(productRepo,source,path.join(source,'SiriusLens.zip'),{}),/Invalid package/);
  await promoteLensPackage(productRepo,source,path.join(source,'SiriusLens.zip'),{jobId:'source'},undefined,path.dirname(source));
  assert.equal(await readFile(path.join(productRepo,'publish/SiriusLens.zip'),'utf8'),'package');
});
