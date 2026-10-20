import { selectJobs, currentJob, resultKey, filterRecords } from './history.js';
import {renderExtras} from './extras.js';
const $ = id => document.getElementById(id);
const labels={build:'빌드',commit:'커밋 + Notion',version:'버전 업그레이드',connect:'Notion 연결',sync:'Notion 재연결'};
const statuses={running:'실행 중',succeeded:'완료',failed:'오류 발생',partial:'일부 완료',interrupted:'확인 필요'};
let state, selection, logId, refreshing=false, starting=false;
let recordProduct='all', displayedJob;
let historyOrder='newest';
const seenStorageKey='dashboard-seen-results';
function readSeen(){try{const value=JSON.parse(localStorage.getItem(seenStorageKey)||'[]');return new Set(Array.isArray(value)?value:[]);}catch{return new Set();}}
// Snapshot on entry: a result stays visible during this visit, but not the next.
const seenOnEntry=readSeen();
let resultVisible=false;
function rememberVisibleResult(){
 if(document.visibilityState!=='visible'||!resultVisible||!displayedJob||displayedJob.status==='running')return;
 try{const seen=readSeen();seen.add(resultKey(displayedJob));localStorage.setItem(seenStorageKey,JSON.stringify([...seen]));}catch{}
}
const resultObserver=new IntersectionObserver(entries=>{resultVisible=entries.some(entry=>entry.isIntersecting);rememberVisibleResult();},{threshold:0.1});
document.addEventListener('visibilitychange',rememberVisibleResult);
const settings=()=>({model:$('model').value,effort:$('effort').value});
for(const [id,key,fallback] of [['model','dashboard-model',''],['effort','dashboard-effort','low']]){
 const saved=localStorage.getItem(key)||fallback, select=$(id);
 if(id==='model' && saved && ![...select.options].some(option=>option.value===saved))select.add(new Option(saved+' (Saved)',saved));
 select.value=[...select.options].some(option=>option.value===saved)?saved:fallback;
 select.addEventListener('change',()=>localStorage.setItem(key,select.value));
}
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function link(url,label){try{const u=new URL(url);if(u.protocol==='https:' && /(^|\.)notion\.(so|com)$/.test(u.hostname))return `<a href="${esc(url)}" target="_blank" rel="noreferrer">${label} ↗</a>`;}catch{}return '';}
async function api(url, body){const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':state.token},body:JSON.stringify(body)}:{});const result=await response.json();if(!response.ok)throw new Error(result.error);return result;}
function notify(message){$('notice').textContent=message;$('notice').hidden=!message;if(message)$('notice').scrollIntoView({behavior:'smooth',block:'nearest'});}
function selectRecordTab(name){for(const id of ['release','build']){const selected=id===name;$(`${id}-tab`).setAttribute('aria-selected',String(selected));$(`${id}-tab`).tabIndex=selected?0:-1;$(`${id}-panel`).hidden=!selected;}}
function render(){
  $('products').innerHTML=state.products.map(p=>{
    const disabled=state.active||starting||p.error?'disabled':'';
    const reason=p.error?'저장소를 확인할 수 없습니다.':state.active?'실행 중인 작업이 끝나면 다음 작업을 진행할 수 있습니다.':p.changes?'미커밋 변경이 있습니다. 먼저 커밋하면 버전 업그레이드가 활성화됩니다.':'미커밋 변경이 없습니다. 새 버전을 준비할 수 있습니다.';
    return `<article class="product"><div class="product-top"><div class="product-icon">${p.id==='lens'?'<img src="/branding/lens.png" alt="LENS">':'<span class="installer-wordmark">LENS<small>INSTALLER</small></span>'}</div><div class="product-title"><h2>${p.id==='lens'?'SIRIUS LENS':'LENS Installer'}</h2><span class="version">v${esc(p.version||'—')}</span></div><span class="change-count">${p.changes?`변경 ${p.changes.split('\n').length}개`:'변경 없음'}</span></div><div class="product-actions"><button ${disabled} data-product="${p.id}" data-action="build" title="${p.id==='lens'?'보호 빌드 · 서명 · ZIP 생성':'설치 · 제거 파일 빌드'}">빌드</button><button ${disabled||(!p.changes?'disabled':'')} class="secondary" data-product="${p.id}" data-action="commit">커밋 + Notion</button><button ${disabled||(p.changes?'disabled':'')} aria-describedby="reason-${p.id}" class="secondary" data-product="${p.id}" data-action="version">버전 업그레이드</button></div><p id="reason-${p.id}" class="action-reason">${esc(reason)}</p></article>`;
  }).join('');
  const expanded=new Set([...$('releases').querySelectorAll('details[open]')].map(el=>el.dataset.version));
  $('releases').innerHTML=filterRecords(state.releases||[],recordProduct,'lens').map(r=>`<article class="release"><div class="release-meta"><span class="record-product">${r.product==='installer'?'Installer':'LENS'}</span><span class="version">v${esc(r.version)}</span><time datetime="${esc(r.date)}">${esc(r.date)}</time></div><div class="release-body"><h3>${esc(r.summary)}</h3><p>${esc(r.note)}</p>${r.referenceCommit?`<details data-version="${esc(r.version)}" ${expanded.has(r.version)?'open':''}><summary>참조 커밋 <code>${esc(r.referenceCommit.slice(0,7))}</code></summary><code class="release-sha">${esc(r.referenceCommit)}</code>${r.commitSubject?`<p>${esc(r.commitSubject)}</p>`:''}</details>`:''}</div></article>`).join('')||'<div class="empty">선택한 제품의 배포 기록이 없습니다.</div>';
  $('connect').disabled=!!state.active;
  const builds=filterRecords(state.builds||state.jobs.filter(j=>j.action==='build'),recordProduct);
  const latestLens=builds.find(j=>j.product==='lens' && j.status==='succeeded' && j.latestOutput);
  $('builds').innerHTML=builds.length?builds.map(j=>`<article class="build-record"><div class="build-record-head"><strong>${j.product==='lens'?'LENS':'Installer'} <span class="version">v${esc(j.currentVersion||'미확인')}</span></strong><span class="badge ${esc(j.status)}">${statuses[j.status]}</span></div><p class="build-time">${new Date(j.startedAt).toLocaleString('ko-KR')} 시작${j.finishedAt?` · ${new Date(j.finishedAt).toLocaleString('ko-KR')} 종료`:''}</p><p><code title="${esc(j.baseHead)}">${esc(j.baseHead?.slice(0,7)||'커밋 미확인')}</code> · ${j.sourceDirty===true?'미커밋 변경 포함':j.sourceDirty===false?'커밋된 소스':'변경 상태 미기록'}${j.sourceSubject?` · ${esc(j.sourceSubject)}`:''}</p>${j.installerSource?`<p class="build-time">포함 Installer v${esc(j.installerSource.version)} · ${esc(j.installerSource.commit.slice(0,7))}${j.installerSource.dirty?' · 미커밋 변경 포함':''}</p>`:''}<div class="job-actions"><button class="secondary" data-log="${j.id}">로그</button><button class="secondary" data-folder="${j.id}">이 빌드 폴더</button>${latestLens?.id===j.id?`<button class="secondary" data-latest="${j.id}">최신 publish 폴더</button>`:''}</div></article>`).join(''):'<div class="empty">대시보드에서 빌드하면 버전·커밋·결과가 기록됩니다.</div>';
  const latest=currentJob(state.jobs,state.active,seenOnEntry);
  displayedJob=latest;
  $('activity').textContent=!latest?'대기':latest.status==='running'?'진행':latest.status==='succeeded'?'완료':'오류';
  $('activity').className=!latest?'idle':latest.status==='running'?'running':latest.status==='succeeded'?'succeeded':'attention';
  $('current-job').innerHTML=latest?jobMarkup(latest):'<div class="empty">진행 중인 작업이 없습니다. 위에서 작업을 선택하세요.</div>';
  if(latest?.status==='running'){
    const progress=document.createElement('div');progress.className='task-progress';
    progress.innerHTML='<div class="progress-caption"><span>작업 진행 중</span><span>완료까지 기다려 주세요</span></div><progress aria-label="현재 작업 진행 중"></progress>';
    $('current-job').append(progress);
  }
  resultObserver.disconnect();resultVisible=false;
  if(latest)resultObserver.observe($('current-job'));
  const pastJobs=state.jobs.filter(job=>job.status!=='running');
  const visibleJobs=selectJobs(filterRecords(pastJobs,$('history-product').value),$('history-status').value,historyOrder);
  $('history-count').textContent=`${visibleJobs.length} / ${pastJobs.length}건`;
  $('jobs').innerHTML=visibleJobs.length?visibleJobs.map(j=>`<div class="job"><span class="badge ${esc(j.status)}">${statuses[j.status]}</span><div class="info"><strong>${j.product==='lens'?'LENS':'Installer'} · ${labels[j.action]}</strong><p title="${esc(j.summary)}">${esc(j.summary)}</p><time>${new Date(j.startedAt).toLocaleString('ko-KR')}</time>${j.notionVersion?`<p class="job-meta">Notion: SIRIUS LENS v${esc(j.notionVersion)} · ${esc(j.model||'Codex 설정 모델')} / ${esc(j.effort||'설정값')}</p>`:''}</div><div class="job-actions">${link(j.taskUrl,'Notion 업무 열기')}${link(j.versionUrl,'제품 버전 열기')}<button class="secondary" data-log="${j.id}">기록</button><button class="secondary" data-folder="${j.id}">폴더</button>${j.commit&&j.status!=='succeeded'?`<button ${state.active?'disabled':''} class="secondary" data-sync="${j.id}" data-product="${j.product}">Notion 재시도</button>`:''}</div></div>`).join(''):'<div class="empty">선택한 조건에 해당하는 실행 기록이 없습니다.</div>';
  for(const button of document.querySelectorAll('[data-folder]')){
    const job=state.jobs.find(item=>item.id===button.dataset.folder);
    button.textContent=job?.action==='build'&&job.status==='succeeded'
      ? job.product==='installer'?'최신 설치 파일':job.archiveOutput?'보관된 빌드':'작업 폴더'
      :'작업 폴더';
  }
  renderExtras(state,recordProduct);
}
function jobMarkup(j){
 return `<div class="job"><span class="badge ${esc(j.status)}">${statuses[j.status]||esc(j.status)}</span><div class="info"><strong>${j.product==='lens'?'LENS':'Installer'} · ${labels[j.action]||esc(j.action)}</strong><p>${esc(j.summary||'작업을 준비하고 있습니다.')}</p><time>${new Date(j.startedAt).toLocaleString('ko-KR')}</time></div><div class="job-actions">${link(j.taskUrl,'Notion 업무 열기')}${link(j.versionUrl,'제품 버전 열기')}<button class="secondary" data-log="${esc(j.id)}">로그 보기</button><button class="secondary" data-folder="${esc(j.id)}">폴더</button>${j.commit&&j.status!=='succeeded'?`<button ${state.active?'disabled':''} class="secondary" data-sync="${esc(j.id)}" data-product="${esc(j.product)}">Notion 재시도</button>`:''}</div></div>`;
}
async function loadLog(){
 const id=logId;if(!id)return;
 try{const result=await api(`/api/log?id=${encodeURIComponent(id)}`);
 if(logId===id){$('log').textContent=result.log||'아직 기록된 로그가 없습니다.';$('log-summary').textContent=result.summary||'';}}
 catch(error){if(logId===id)$('log').textContent=`로그를 불러오지 못했습니다: ${error.message}`;}
}
async function refresh(){if(refreshing)return;refreshing=true;try{const next=await api('/api/state');const changed=JSON.stringify(next)!==JSON.stringify(state);state=next;if(changed)render();if(logId&&!$('log-panel').hidden)await loadLog();}catch(error){notify(error.message);}finally{refreshing=false;}}
document.addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button)return;
 try{
  if(button.id==='history-order'){
    historyOrder=historyOrder==='newest'?'oldest':'newest';
    const label=historyOrder==='newest'?'최신순':'오래된 순',next=historyOrder==='newest'?'오래된 순':'최신순';
    $('history-order-text').textContent=label;button.title=`${next}으로 변경`;button.setAttribute('aria-label',`${label} 정렬, 클릭하면 ${next}으로 변경`);
    if(state)render();
  }
  else if(button.dataset.recordProduct){recordProduct=button.dataset.recordProduct;for(const item of document.querySelectorAll('[data-record-product]'))item.setAttribute('aria-pressed',String(item.dataset.recordProduct===recordProduct));render();}
  else if(button.dataset.recordTab){selectRecordTab(button.dataset.recordTab);}
  else if(button.dataset.action){
   if(button.dataset.action==='build'){
    if(starting||state.active)return;
    starting=true;render();
    try{await api('/api/jobs',{product:button.dataset.product,action:'build'});notify('');}
    finally{starting=false;await refresh();}
    return;
   }
   selection={product:button.dataset.product,action:button.dataset.action};
   const p=state.products.find(p=>p.id===selection.product);
   $('action-form').reset();$('dialog-title').textContent=`${p.name} · ${labels[selection.action]}`;
   $('dialog-description').textContent=selection.action==='build'?(p.id==='lens'?'보호 빌드 결과에 서명한 뒤 ZIP을 만듭니다. 인스톨러는 별도로 빌드하세요. 인증 요청이 뜨면 인증을 완료하세요.':'제거 프로그램을 먼저 게시·검증한 뒤 인스톨러에 내장합니다.'):selection.action==='commit'?'현재 변경 사항을 검토·검증하고 커밋합니다. 이어서 Notion 업무를 작성하고 제품과 버전을 연결합니다.':'마지막 버전 태그 이후 변경 내용을 바탕으로 버전과 업데이트 사항을 수정·검증·커밋하고 Notion에 연결합니다.';
   $('version-label').hidden=selection.action!=='version';$('agent-fields').hidden=selection.action==='build';
   if(selection.action==='version'){const parts=p.version.split('.');parts[2]=Number(parts[2])+1;$('action-form').elements.version.value=parts.join('.');}
   $('notion-target').textContent=p.id==='installer'?'Notion 연결: SIRIUS LENS v'+state.products.find(item=>item.id==='lens').version+' (기존 제품 버전 재사용)':'Notion 연결: SIRIUS LENS 제품 버전';
   $('submit-action').textContent=selection.action==='commit'?'커밋 및 기록':'버전 업그레이드';
   $('changes').textContent=p.changes||`현재 버전 ${p.version} · ${p.head.slice(0,7)}`;$('dialog-error').textContent='';$('submit-action').disabled=false;$('action-dialog').showModal();
  }else if(button.dataset.log){logId=button.dataset.log;$('log').textContent='불러오는 중…';$('log-panel').hidden=false;$('log-panel').scrollIntoView({behavior:'smooth',block:'nearest'});await loadLog();}
  else if(button.dataset.folder||button.dataset.latest){
    const label=button.textContent,icon=button.querySelector('img'),title=button.title;
    button.disabled=true;button.setAttribute('aria-busy','true');
    if(icon)button.title='폴더 여는 중…';else button.textContent='폴더 여는 중…';
    try{await api('/api/open',{id:button.dataset.folder||button.dataset.latest,latest:!!button.dataset.latest});if(!icon)button.textContent='열기 요청 완료';}
    catch(error){if(!icon)button.textContent=label;throw error;}
    finally{button.disabled=false;button.removeAttribute('aria-busy');if(icon)button.title=title;}
  }
  else if(button.dataset.sync){await api('/api/jobs',{action:'sync',product:button.dataset.product,jobId:button.dataset.sync,...settings()});await refresh();}
 }catch(error){notify(error.message);}
});
document.querySelector('.record-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'release':event.key==='End'?'build':$('release-tab').getAttribute('aria-selected')==='true'?'build':'release';selectRecordTab(next);$(`${next}-tab`).focus();});
$('action-form').addEventListener('submit',async event=>{event.preventDefault();$('submit-action').disabled=true;try{const values=Object.fromEntries(new FormData(event.target));await api('/api/jobs',{...selection,...values,...settings()});$('action-dialog').close();notify('');await refresh();}catch(error){$('dialog-error').textContent=error.message;}finally{$('submit-action').disabled=false;}});
for(const id of ['close-dialog','cancel-dialog'])$(id).onclick=()=>$('action-dialog').close();
$('close-log').onclick=()=>{$('log-panel').hidden=true;logId=null;};
$('connect').onclick=async()=>{try{await api('/api/jobs',{product:'lens',action:'connect'});notify('브라우저에 나타나는 Notion 인증을 완료하세요. 인증 주소는 작업 기록에서도 확인할 수 있습니다.');await refresh();}catch(error){notify(error.message);}};
for(const id of ['history-product','history-status'])$(id).addEventListener('change',()=>{if(state)render();});
await refresh();setInterval(refresh,4000);
