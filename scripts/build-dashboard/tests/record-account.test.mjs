import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {safeAccount} from '../account.mjs';
import {createRecordEdits} from '../record-edits.mjs';
import {createDashboard,dashboardRoot} from '../server.mjs';
test('account view exposes no tokens and distinguishes unavailable quota from zero',()=>{
 const result=safeAccount({type:'chatgpt',email:'demo@example.com',accessToken:'secret'},{rateLimitsByLimitId:{codex:{primary:{usedPercent:100},secondary:{usedPercent:null}}}});
 assert.equal(result.windows[0].remaining,0);assert.equal(result.windows[1].remaining,null);
 assert.equal(JSON.stringify(result).includes('secret'),false);
 assert.equal(safeAccount(null).connected,false);
});
test('record edits serialize, persist and reject invalid targets or fields',async()=>{
 const root=await mkdtemp(path.join(dashboardRoot,'artifacts/record-edit-test-')),store=createRecordEdits(root);
 await Promise.all(['a','b'].map(id=>store.save({id,title:id,content:'설명',commit:'wrong'},['a','b'])));
 const values=await createRecordEdits(root).read();
 assert.deepEqual(values.a,{title:'a',content:'설명'});assert.ok(values.b);
 await assert.rejects(store.save({id:'../../wrong',title:'a',content:''},['a']));
 await assert.rejects(store.save({id:'a',title:' ',content:''},['a']));
});
test('edit endpoint requires dashboard token and preserves build metadata',async()=>{
 const root=await mkdtemp(path.join(dashboardRoot,'artifacts/record-api-test-'));
 const {server,jobs}=await createDashboard({dataRoot:root,inspect:async id=>({id,version:'1.0.2'})});
 jobs.push({id:'fixture',action:'build',product:'lens',status:'succeeded',currentVersion:'1.0.2',baseHead:'original'});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const url=`http://127.0.0.1:${server.address().port}`,state=await(await fetch(url+'/api/state')).json();
  const post=token=>fetch(url+'/api/records/edit',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':token},body:JSON.stringify({id:'build:fixture',title:'새 제목',content:'새 설명',baseHead:'wrong'})});
  assert.equal((await post('wrong')).status,403);assert.equal((await post(state.token)).status,200);
  const updated=await(await fetch(url+'/api/state')).json();
  assert.equal(updated.builds[0].baseHead,'original');assert.equal(updated.recordEdits['build:fixture'].title,'새 제목');
 }finally{server.close();await once(server,'close');}
});
