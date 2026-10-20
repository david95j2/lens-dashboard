import {sortReleases,selectJobs,buildTags,quotaDisplay} from './history.js';
let state,editId,releaseOrder='high',buildOrder='newest';
let selectedProduct,expectedPath,checkedPath,checking=false;
const $=id=>document.getElementById(id);
const account=document.createElement('details');account.className='account-menu';
account.innerHTML='<summary id="account-label">Codex · 계정 확인</summary><section class="account-panel"><h3>Codex 계정</h3><div id="account-data">불러오는 중…</div><p class="account-hint">남은 사용량은 토큰 개수가 아닌 계정 한도입니다. 로컬 빌드는 AI 사용량과 무관합니다.</p><div class="job-actions"><button id="account-refresh" class="secondary">사용량 새로고침</button><button id="account-change" class="secondary">계정 변경</button></div><p id="account-error" role="status"></p><a id="account-login-link" hidden target="_blank" rel="noreferrer">공식 로그인 페이지 열기 ↗</a><button id="account-cancel" class="secondary" hidden>로그인 취소</button></section>';
document.querySelector('.common-settings').append(account);
const dialog=document.createElement('dialog');dialog.id='record-dialog';
dialog.innerHTML='<form id="record-form"><h2>기록 수정</h2><p>이 대시보드의 제목과 설명만 변경합니다. 버전·커밋·파일 경로와 Notion 기록은 변경하지 않습니다.</p><label>제목<input id="record-title" required maxlength="200"></label><label>내용<textarea id="record-content" rows="5" maxlength="3000"></textarea></label><p id="record-error" role="alert"></p><div class="dialog-actions"><button type="button" id="record-cancel" class="secondary">취소</button><button id="record-save">저장</button></div></form>';
document.body.append(dialog);
const repoDialog=document.createElement('dialog');repoDialog.id='repository-dialog';
repoDialog.setAttribute('aria-labelledby','repository-title');
repoDialog.innerHTML='<form id="repository-form"><h2 id="repository-title">프로젝트 연결</h2><p>빌드·커밋·버전 조회에 사용할 로컬 Git 저장소를 선택하세요. 연결만 변경하며 빌드나 커밋은 실행하지 않습니다.</p><label>현재 연결<input id="repository-current" readonly></label><label>연결할 소스코드 폴더<input id="repository-path" required autocomplete="off" placeholder="C:\\\\Projects\\\\SIRIUS_LENS"></label><div class="job-actions"><button type="button" id="repository-browse" class="secondary">폴더 선택</button><button type="button" id="repository-check" class="secondary">폴더 검사</button></div><p id="repository-result" role="status"></p><p>기존 작업 기록은 이전 경로를 유지합니다. 선택한 폴더의 빌드 스크립트를 신뢰할 수 있는지 확인하세요.</p><div class="dialog-actions"><button type="button" id="repository-cancel" class="secondary">취소</button><button id="repository-save" disabled>연결 저장</button></div></form>';
document.body.append(repoDialog);
function invalidateRepository(){checkedPath=null;$('repository-save').disabled=true;$('repository-result').textContent='폴더를 검사한 뒤 연결할 수 있습니다.';}
async function checkRepository(){
 if(checking)return;checking=true;invalidateRepository();
 $('repository-check').disabled=true;$('repository-browse').disabled=true;
 const input=$('repository-path').value.trim(),product=selectedProduct;
 $('repository-result').textContent='저장소와 빌드 구조를 확인하고 있습니다…';
 try{
  const result=await api('/api/repository/check',{product,path:input});
  if(selectedProduct!==product||$('repository-path').value.trim()!==input)return;
  $('repository-path').value=result.repo;checkedPath=result.repo;
  $('repository-result').textContent=`확인 완료 · v${result.version} · ${result.branch||'Detached HEAD'} · ${result.head.slice(0,7)}`;
  $('repository-save').disabled=false;
 }catch(error){$('repository-result').textContent=error.message;}
 finally{checking=false;$('repository-check').disabled=false;$('repository-browse').disabled=false;}
}
$('repository-path').oninput=invalidateRepository;
$('repository-check').onclick=checkRepository;
$('repository-cancel').onclick=()=>repoDialog.close();
$('repository-browse').onclick=async()=>{
 $('repository-browse').disabled=true;
 try{const result=await api('/api/repository/pick',{});if(result.path){$('repository-path').value=result.path;await checkRepository();}}
 catch(error){$('repository-result').textContent=error.message;}
 finally{$('repository-browse').disabled=false;}
};
$('repository-form').onsubmit=async e=>{
 e.preventDefault();if(!checkedPath||checkedPath!==$('repository-path').value.trim())return;
 $('repository-save').disabled=true;
 try{await api('/api/repository/link',{product:selectedProduct,path:checkedPath,expectedPath});location.reload();}
 catch(error){$('repository-result').textContent=error.message;$('repository-save').disabled=false;}
};
const orderButton=document.createElement('button');orderButton.id='record-order';orderButton.className='history-sort';
const tabs=document.querySelector('.record-tabs'),toolbar=document.createElement('div');toolbar.className='record-toolbar';
tabs.before(toolbar);toolbar.append(tabs,orderButton);
function applyRecordOrder(){
 const release=$('release-tab').getAttribute('aria-selected')==='true';
 const label=release?(releaseOrder==='high'?'높은 순':'낮은 순'):(buildOrder==='newest'?'최신 순':'오래된 순');
 orderButton.textContent=label+' ↕';orderButton.setAttribute('aria-label',`${release?'배포 버전':'빌드 날짜'} ${label}, 클릭하여 정렬 변경`);
 if(!state)return;
 for(const [root,records] of [[$('releases'),sortReleases(state.releases,releaseOrder)],[$('builds'),selectJobs(state.builds||[], 'all',buildOrder)]]){
   const elements=new Map([...root.children].map(el=>[el.dataset.recordKey,el]));
   for(const r of records){const key=r.id?'build:'+r.id:`release:${r.product||'lens'}:${r.version}`;if(elements.has(key))root.append(elements.get(key));}
 }
}
orderButton.onclick=()=>{if($('release-tab').getAttribute('aria-selected')==='true')releaseOrder=releaseOrder==='high'?'low':'high';else buildOrder=buildOrder==='newest'?'oldest':'newest';applyRecordOrder();};
new MutationObserver(applyRecordOrder).observe($('release-tab'),{attributes:true,attributeFilter:['aria-selected']});
async function api(url,body){
 const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':state.token},body:JSON.stringify(body)}:{});
 const data=await r.json();if(!r.ok)throw Error(data.error);return data;
}
function tag(parent,text){const span=document.createElement('span');span.className=text==='현재 버전'?'record-tag current-version':'record-tag';span.textContent=text;parent.append(span);}
function editable(parent,id,title,content){
 const button=document.createElement('button');button.className='secondary record-edit';button.title='기록 수정';button.setAttribute('aria-label',`${title} 수정`);
 const image=document.createElement('img');image.src='/branding/edit.svg';image.alt='';button.append(image);
 button.onclick=()=>{editId=id;$('record-title').value=title;$('record-content').value=content;$('record-error').textContent='';dialog.showModal();};
 parent.append(button);
}
export function renderExtras(next,filter){
 state=next;
 const versionLink=$('notion-version-link'),database=state.notion?.versionDatabase;
 versionLink.hidden=!/^[a-f0-9-]{32,36}$/i.test(database||'');
 if(!versionLink.hidden)versionLink.href=`https://app.notion.com/p/${database}`;
 document.querySelectorAll('#products .product').forEach((card,i)=>{
  const product=state.products[i],heading=card.querySelector('h2');
  const row=document.createElement('div');row.className='product-name-row';heading.before(row);row.append(heading);
  const button=document.createElement('button');button.className='project-link';button.type='button';
  button.title='로컬 프로젝트 연결';button.setAttribute('aria-label',`${product.id==='lens'?'LENS':'Installer'} 로컬 프로젝트 연결`);
  button.disabled=!!state.active;
  const img=document.createElement('img');img.src='/link.svg';img.alt='';button.append(img);row.append(button);
  button.onclick=()=>{
   selectedProduct=product.id;expectedPath=product.repo;invalidateRepository();
   $('repository-title').textContent=`${product.id==='lens'?'LENS':'Installer'} 프로젝트 연결`;
   $('repository-current').value=product.repo||'';$('repository-path').value=product.repo||'';repoDialog.showModal();
  };
 });
 const version=p=>String(state.products.find(x=>x.id===p)?.version||'').replace(/^v/i,'');
 const releases=state.releases.filter(r=>filter==='all'||(r.product||'lens')===filter);
 document.querySelectorAll('#releases .release').forEach((el,i)=>{
  const r=releases[i],id=`release:${r.product||'lens'}:${r.version}`,edit=state.recordEdits?.[id];
  el.dataset.recordKey=id;
  if(edit){el.querySelector('h3').textContent=edit.title;el.querySelector('.release-body > p').textContent=edit.content;}
  const heading=el.querySelector('h3'),titleRow=document.createElement('div');titleRow.className='record-title-row';heading.before(titleRow);titleRow.append(heading);
  if(version(r.product||'lens')===r.version.replace(/^v/i,''))tag(titleRow,'현재 버전');
  editable(el,id,edit?.title??r.summary,edit?.content??r.note);
 });
 const all=state.builds||[],builds=all.filter(j=>filter==='all'||j.product===filter);
 document.querySelectorAll('#builds .build-record').forEach((el,i)=>{
  const j=builds[i],id='build:'+j.id,edit=state.recordEdits?.[id],head=el.querySelector('.build-record-head');
  el.dataset.recordKey=id;
  const title=edit?.title??`${j.product==='lens'?'LENS':'Installer'} 빌드`,content=edit?.content??j.summary??'';
  const h=document.createElement('h3');h.textContent=title;const p=document.createElement('p');p.className='record-note';p.textContent=content;
  const titleRow=document.createElement('div');titleRow.className='record-title-row';titleRow.append(h);
  for(const text of buildTags(j,all,version(j.product)))tag(titleRow,text);
  head.after(titleRow,p);
  if(j.status!=='running')editable(el,id,title,content);
  const rail=document.createElement('div');rail.className='build-icon-actions';
  const editButton=el.querySelector('.record-edit');
  if(editButton){rail.append(editButton);const separator=document.createElement('span');separator.className='action-divider';separator.setAttribute('aria-hidden','true');rail.append(separator);}
  for(const button of el.querySelectorAll('.job-actions button')){
    const label=button.dataset.log?'로그 보기':button.textContent.trim();
    button.title=label;button.setAttribute('aria-label',label);button.classList.add('record-file-icon');
    const image=document.createElement('img');image.src=button.dataset.log?'/memo-pad-duotone-light-full.svg':'/branding/folder-open.svg';image.alt='';
    button.replaceChildren(image);rail.append(button);
  }
  el.querySelector('.job-actions')?.remove();el.append(rail);
 });
 applyRecordOrder();
}
$('record-cancel').onclick=()=>dialog.close();
$('record-form').onsubmit=async e=>{
 e.preventDefault();$('record-save').disabled=true;
 try{await api('/api/records/edit',{id:editId,title:$('record-title').value,content:$('record-content').value});dialog.close();location.reload();}
 catch(error){$('record-error').textContent=error.message;}finally{$('record-save').disabled=false;}
};
async function loadAccount(force=false){
 $('account-refresh').disabled=true;
 try{
  const data=await api(force?'/api/account/refresh':'/api/account',force?{}:null);
  $('account-label').textContent=`Codex · ${data.email|| (data.connected?'연결됨':'계정 확인')}`;
  const root=$('account-data');root.replaceChildren();
  const identity=document.createElement('p');identity.textContent=data.email|| (data.connected?data.type:'연결 확인 필요');root.append(identity);
  const plan=document.createElement('p');plan.textContent=data.type==='chatgpt'?'ChatGPT 로그인':data.type==='apiKey'?'API Key 로그인':'';root.append(plan);
  for(const w of data.windows||[]){
   const block=document.createElement('div');block.className='quota';
   const display=quotaDisplay(w,!!data.error);
   const label=document.createElement('strong');label.textContent=`${w.name} · ${w.minutes?`${w.minutes>=1440?w.minutes/1440+'일':w.minutes/60+'시간'}`:'사용 한도'} · ${display.text}`;
   block.append(label);
   if(display.available){const progress=document.createElement('progress');progress.max=100;progress.value=w.remaining;block.append(progress);}
   const reset=document.createElement('small');reset.textContent=w.resetsAt?`${new Date(w.resetsAt*1000).toLocaleString('ko-KR')} 초기화`:'초기화 시간 미제공';block.append(reset);root.append(block);
  }
  $('account-error').textContent=data.error||(!data.windows?.length?'조회 가능한 사용량 정보가 없습니다.':'');
  $('account-cancel').hidden=!data.loginPending;$('account-change').disabled=!!data.loginPending;
  if(!data.loginPending)$('account-login-link').hidden=true;
 }catch(error){$('account-data').textContent='사용량 조회 불가';$('account-error').textContent=error.message;}
 finally{$('account-refresh').disabled=false;}
}
$('account-refresh').onclick=()=>loadAccount(true);
account.addEventListener('toggle',()=>{if(account.open)loadAccount();});
document.addEventListener('click',e=>{if(account.open&&!account.contains(e.target))account.open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')account.open=false;});
$('account-change').onclick=async()=>{
 if(!confirm('이 PC의 Codex CLI와 인증 정보를 공유하는 도구에도 영향을 줄 수 있습니다. 공식 로그인 페이지에서 다른 계정으로 로그인하시겠습니까?'))return;
 $('account-change').disabled=true;
 try{const result=await api('/api/account/login',{});const a=$('account-login-link');a.href=result.authUrl;a.hidden=false;$('account-cancel').hidden=false;$('account-error').textContent='아래 공식 로그인 링크를 열어 인증을 완료하세요.';}
 catch(error){$('account-error').textContent=error.message;$('account-change').disabled=false;}
};
$('account-cancel').onclick=async()=>{try{await api('/api/account/cancel',{});await loadAccount(true);}catch(e){$('account-error').textContent=e.message;}};
setInterval(()=>{if(account.open&&!document.hidden)loadAccount();},15000);
loadAccount();
