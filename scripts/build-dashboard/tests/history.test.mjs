import test from 'node:test';
import assert from 'node:assert/strict';
import {selectJobs,currentJob,resultKey,filterRecords} from '../public/history.js';
import {notionStartDate,makePrompt} from '../workflow.mjs';

const jobs=['succeeded','failed','partial','interrupted','running'].map((status,i)=>({
  id:i,status,startedAt:new Date(Date.UTC(2026,9,20,i)).toISOString()
}));
test('current task prioritizes active work and otherwise shows the newest result',()=>{
  assert.equal(currentJob(jobs,4).id,4);
  assert.equal(currentJob(jobs).id,4);
  assert.equal(currentJob(jobs.slice(0,4)).id,3);
  assert.equal(currentJob([...jobs].reverse(),0).id,4);
  assert.equal(currentJob([]),undefined);
});
test('history sorts both directions without mutating source and combines status filters',()=>{
  assert.deepEqual(selectJobs(jobs).map(j=>j.id),[4,3,2,1,0]);
  assert.deepEqual(selectJobs(jobs,'all','oldest').map(j=>j.id),[0,1,2,3,4]);
  assert.deepEqual(selectJobs(jobs,'error','oldest').map(j=>j.id),[1,2,3]);
  assert.deepEqual(selectJobs(jobs,'succeeded').map(j=>j.id),[0]);
  assert.deepEqual(selectJobs(jobs,'running').map(j=>j.id),[4]);
  assert.deepEqual(jobs.map(j=>j.id),[0,1,2,3,4]);
  assert.deepEqual(selectJobs([]),[]);
  assert.deepEqual(selectJobs(jobs,'unknown'),[]);
  assert.equal(selectJobs([...jobs,{id:9}])[5].id,9);
});
test('seen terminal results wait on next visit without hiding running or new results',()=>{
 const completed={id:'done',status:'succeeded',startedAt:'2026-10-20T02:00:00Z',finishedAt:'2026-10-20T03:00:00Z'};
 const old={id:'old',status:'failed',startedAt:'2026-10-19T02:00:00Z'};
 const seen=new Set([resultKey(completed)]);
 assert.equal(currentJob([old,completed],undefined,seen),undefined);
 assert.equal(currentJob([completed],undefined,new Set()),completed);
 const running={...completed,status:'running'};
 assert.equal(currentJob([running],running.id,seen),running);
 const error={...completed,status:'failed'};
 assert.equal(currentJob([error],undefined,seen),error);
 seen.add(resultKey(error));
 assert.equal(currentJob([error],undefined,seen),undefined);
});
test('product filter applies independently to both release and build records',()=>{
 const records=[{id:1,product:'lens'},{id:2,product:'installer'},{id:3}];
 assert.equal(filterRecords(records,'all').length,3);
 assert.deepEqual(filterRecords(records,'lens','lens').map(r=>r.id),[1,3]);
 assert.deepEqual(filterRecords(records,'installer','lens').map(r=>r.id),[2]);
 assert.deepEqual(filterRecords(records,'lens').map(r=>r.id),[1]);
});
test('work history combines product and status filters in either sort direction',()=>{
 const items=jobs.map((job,i)=>({...job,product:i%2===0?'lens':'installer'}));
 assert.deepEqual(selectJobs(filterRecords(items,'lens'),'all','newest').map(j=>j.id),[4,2,0]);
 assert.deepEqual(selectJobs(filterRecords(items,'lens'),'all','oldest').map(j=>j.id),[0,2,4]);
 assert.deepEqual(selectJobs(filterRecords(items,'installer'),'error','oldest').map(j=>j.id),[1,3]);
 assert.deepEqual(selectJobs(filterRecords(items,'installer'),'succeeded','newest'),[]);
});
test('Notion start date uses Korea date boundary and preserves original execution on retries',()=>{
  assert.equal(notionStartDate({startedAt:'2026-10-19T16:30:00Z'}),'2026-10-20');
  const job={id:'retry',action:'sync',options:{},startedAt:'2026-10-22T02:00:00Z',workStartedAt:'2026-10-19T16:30:00Z'};
  assert.equal(notionStartDate(job),'2026-10-20');
  assert.equal(notionStartDate({startedAt:'invalid'}),'');
  const prompt=makePrompt(job,{notion:{}},'repo');
  assert.match(prompt,/set its date to 2026-10-20/);
  assert.match(prompt,/Preserve any existing 작업 시작/);
  assert.match(prompt,/'버튼을 배치합니다.' -> '버튼 배치'/);
  assert.match(prompt,/set 작업 종료 when marking 업무 상태=개발 완료/);
  assert.match(prompt,/git show -s --format=%cI/);
  assert.match(prompt,/On Notion-only retries use the same existing commit timestamp/);
  assert.match(prompt,/verify BOTH 작업 시작 and 작업 종료/);
  assert.match(prompt,/완료 목표 날짜 empty unless provided; it is a deadline/);
});
