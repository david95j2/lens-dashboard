import { cp, mkdir, readFile, writeFile, rename, lstat, rm } from 'node:fs/promises';
import path from 'node:path';

async function exists(target) {
  try { return await lstat(target); } catch(error) { if(error.code==='ENOENT')return null; throw error; }
}

// Retain the previous output only during promotion, to allow rollback on failure.
export async function promoteLensPackage(repo, jobDir, zip, metadata, archiveRoot, dataRoot = path.join(repo,'artifacts','dashboard')) {
  const root=path.resolve(repo), job=path.resolve(jobDir);
  if(path.dirname(job)!==path.resolve(dataRoot) || path.dirname(path.resolve(zip))!==job) throw new Error('Invalid package source path.');
  const destination=path.join(root,'publish'), ready=path.join(job,'publish-ready'), backup=path.join(job,'previous-publish');
  const old=await exists(destination);
  if(old) {
    if(old.isSymbolicLink() || !old.isDirectory()) throw new Error('publish must be a regular directory.');
    let owner;
    try {owner=JSON.parse(await readFile(path.join(destination,'.dashboard-publish.json'),'utf8'));}catch{}
    if(owner?.kind!=='sirius-build-dashboard') throw new Error('기존 publish 폴더는 대시보드가 생성한 폴더가 아닙니다. 내용 확인 후 다른 위치로 옮겨 주세요.');
  }
  if(await exists(ready) || await exists(backup)) throw new Error('Publish staging or backup already exists.');
  await mkdir(ready);
  await cp(path.join(job,'SiriusLens'),path.join(ready,'SiriusLens'),{recursive:true,errorOnExist:true,force:false});
  await cp(zip,path.join(ready,'SiriusLens.zip'),{errorOnExist:true,force:false});
  const packageInfo=JSON.parse((await readFile(path.join(job,'package.json'),'utf8')).replace(/^\uFEFF/,''));
  let protectedRun;
  if(packageInfo.SourceCandidate) {
    const candidate=path.resolve(packageInfo.SourceCandidate);
    protectedRun=path.dirname(candidate);
    const protection=path.join(root,'artifacts','protection');
    if(path.basename(candidate)!=='unsigned-candidate' || path.dirname(protectedRun)!==protection)
      throw new Error('Refusing to clean an unexpected protected build path.');
    for(const target of [protection,protectedRun]) {
      const stat=await lstat(target);
      if(stat.isSymbolicLink() || !stat.isDirectory())throw new Error('Refusing to clean linked protected build paths.');
    }
  }
  await writeFile(path.join(ready,'build-info.json'),JSON.stringify({...packageInfo,...metadata,zip:path.join(destination,'SiriusLens.zip')},null,2));
  await writeFile(path.join(ready,'.dashboard-publish.json'),JSON.stringify({kind:'sirius-build-dashboard',jobId:metadata.jobId}));
  if(archiveRoot) {
    if(!path.isAbsolute(archiveRoot))throw new Error('Archive path must be absolute.');
    const archive=path.join(archiveRoot,path.basename(job));
    const pending=archive+'.pending';
    await mkdir(archiveRoot,{recursive:true});
    if(await exists(archive) || await exists(pending))throw new Error('Archive already exists; refusing overwrite.');
    // Archive first: a missing/full D: drive must not replace the current release.
    await cp(ready,pending,{recursive:true,errorOnExist:true,force:false});
    if(protectedRun && await exists(path.join(protectedRun,'private')))
      await cp(path.join(protectedRun,'private'),path.join(pending,'private-diagnostics'),{recursive:true,errorOnExist:true,force:false});
    await writeFile(path.join(pending,'build-info.json'),JSON.stringify({...packageInfo,...metadata,zip:path.join(archive,'SiriusLens.zip')},null,2));
    await rename(pending,archive);
  }
  if(old)await rename(destination,backup);
  try {await rename(ready,destination);}
  catch(error) {if(old)await rename(backup,destination);throw error;}
  if(old)await rm(backup,{recursive:true});
  await rm(path.join(job,'SiriusLens'),{recursive:true});
  await rm(path.resolve(zip));
  // Only clean the protected run explicitly recorded by this successful build.
  if(protectedRun)await rm(protectedRun,{recursive:true});
  return path.join(destination,'SiriusLens.zip');
}
