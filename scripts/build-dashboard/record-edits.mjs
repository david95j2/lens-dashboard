import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
export const releaseKey=r=>`release:${r.product||'lens'}:${r.version}`;
export function createRecordEdits(root){
  const file=path.join(root,'record-edits.json');let queue=Promise.resolve();
  async function read(){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
  function save(body,validKeys){
    const work=queue.then(async()=>{
      if(!validKeys.includes(body.id))throw new Error('수정할 기록을 찾을 수 없습니다.');
      if(typeof body.title!=='string'||!body.title.trim()||body.title.length>200||typeof body.content!=='string'||body.content.length>3000)throw new Error('제목은 1~200자, 내용은 3,000자 이내로 입력하세요.');
      const edits=await read();edits[body.id]={title:body.title.trim(),content:body.content.trim()};
      await mkdir(root,{recursive:true});await writeFile(file+'.tmp',JSON.stringify(edits,null,2));await rename(file+'.tmp',file);
    });queue=work.catch(()=>{});return work;
  }
  return {read,save};
}
