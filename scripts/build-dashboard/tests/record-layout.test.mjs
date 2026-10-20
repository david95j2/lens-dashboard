import test from 'node:test';
import assert from 'node:assert/strict';
import {sortReleases,selectJobs,buildTags,quotaDisplay} from '../public/history.js';
test('release sorting compares version numbers, not strings, without changing source',()=>{
 const records=[{version:'1.2.0'},{version:'1.10.0'},{version:'1.0.9'}];
 assert.deepEqual(sortReleases(records).map(r=>r.version),['1.10.0','1.2.0','1.0.9']);
 assert.deepEqual(sortReleases(records,'low').map(r=>r.version),['1.0.9','1.2.0','1.10.0']);
 assert.equal(records[0].version,'1.2.0');
});
test('same-version builds show tags only on the latest success per product in either order',()=>{
 const jobs=[
 {id:'old',product:'lens',currentVersion:'1.0.2',status:'succeeded',startedAt:'2026-10-19'},
 {id:'new',product:'lens',currentVersion:'1.0.2',status:'succeeded',startedAt:'2026-10-20'},
 {id:'failed',product:'lens',currentVersion:'1.0.2',status:'failed',startedAt:'2026-10-21'},
 {id:'installer',product:'installer',currentVersion:'1.0.0',status:'succeeded',startedAt:'2026-10-18'}];
 for(const order of ['oldest','newest']){
   const sorted=selectJobs(jobs,'all',order);
   assert.deepEqual(buildTags(jobs[0],sorted,'1.0.2'),[]);
   assert.deepEqual(buildTags(jobs[1],sorted,'1.0.2'),['현재 버전','최근 성공 빌드']);
   assert.deepEqual(buildTags(jobs[2],sorted,'1.0.2'),[]);
   assert.deepEqual(buildTags(jobs[3],sorted,'1.0.0'),['현재 버전','최근 성공 빌드']);
 }
 assert.deepEqual(selectJobs(jobs,'all','oldest').map(j=>j.id),['installer','old','new','failed']);
});
test('unavailable quota never renders zero percent or a progress bar',()=>{
 for(const value of [undefined,null,NaN,'0']){
   assert.deepEqual(quotaDisplay({remaining:value}),{available:false,text:'조회 불가'});
 }
 assert.deepEqual(quotaDisplay({remaining:0},true),{available:false,text:'조회 불가'});
 assert.deepEqual(quotaDisplay({remaining:0}),{available:true,text:'0% 남음'});
});
