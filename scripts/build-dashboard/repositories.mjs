import path from 'node:path';
import {realpath,stat,readFile} from 'node:fs/promises';
export async function validateRepository(product,input,git){
  if(!['lens','installer'].includes(product))throw new Error('제품을 확인하세요.');
  if(typeof input!=='string'||!path.isAbsolute(input.trim()))throw new Error('소스코드 폴더의 전체 경로를 입력하세요.');
  const repo=await realpath(input.trim());
  if(!(await stat(repo)).isDirectory())throw new Error('폴더를 선택하세요.');
  const top=await realpath(await git(repo,['rev-parse','--show-toplevel']));
  if(top.toLowerCase()!==repo.toLowerCase())throw new Error('Git 저장소 최상위 폴더를 선택하세요.');
  await git(repo,['rev-parse','--verify','HEAD']);
  const files=product==='lens'
    ?['src/SiriusLens.App/SiriusLens.App.csproj','scripts/publish-protected.ps1']
    :['LensInstaller/LensInstaller.csproj','LensUnInstaller/LensUnInstaller.csproj','LensInstaller/SiriusApi.json','scripts/publish.ps1'];
  for(const file of files){
    try{if(!(await stat(path.join(repo,file))).isFile())throw Error();}
    catch{throw new Error(`선택한 폴더에 ${file}이 없습니다. ${product==='lens'?'LENS':'Installer'} 저장소를 선택하세요.`);}
  }
  const version=product==='lens'
    ?(await readFile(path.join(repo,files[0]),'utf8')).match(/<Version>([^<]+)<\/Version>/)?.[1]
    :JSON.parse(await readFile(path.join(repo,'LensInstaller/SiriusApi.json'),'utf8')).installerVersion;
  if(!version)throw new Error('제품 버전을 확인할 수 없습니다.');
  return {repo,version,branch:await git(repo,['branch','--show-current']),head:await git(repo,['rev-parse','HEAD'])};
}
