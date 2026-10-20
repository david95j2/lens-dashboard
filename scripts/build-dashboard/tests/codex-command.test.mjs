import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, utimes, rename } from 'node:fs/promises';
import { resolveCodexCommand } from '../codex-command.mjs';
import { dashboardRoot as lensRoot } from '../server.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(lensRoot,'artifacts/dashboard-codex-test-'));
  const base = path.join(root,'OpenAI','Codex','bin');
  const add = async (version, time) => {
    const dir = path.join(base,version); await mkdir(dir,{recursive:true});
    const file = path.join(dir,'codex.exe'); await writeFile(file,'fixture');
    await utimes(dir,time,time); return file;
  };
  return {root,base,add};
}
test('double-click environment without CLI on PATH resolves newest desktop binary and follows updates',async()=>{
  const f = await fixture(); await f.add('old',new Date(10000));
  const current = await f.add('current',new Date(20000));
  const options={platform:'win32',env:{LOCALAPPDATA:f.root,Path:''}};
  assert.equal(await resolveCodexCommand(options),current);
  const next=await f.add('next',new Date(30000));
  assert.equal(await resolveCodexCommand(options),next);
  await rename(next,next+'.removed');
  assert.equal(await resolveCodexCommand(options),current);
});
test('absolute PATH entry takes precedence and supports spaces and mixed-case Path',async()=>{
  const f=await fixture();await f.add('app',new Date());
  const dir=path.join(f.root,'CLI with spaces');await mkdir(dir);
  const file=path.join(dir,'codex.exe');await writeFile(file,'fixture');
  assert.equal(await resolveCodexCommand({platform:'win32',env:{LOCALAPPDATA:f.root,Path:`.;"${dir}"`}}),file);
});
test('missing CLI gives actionable error, ignoring relative PATH entries',async()=>{
  const f=await fixture();
  await assert.rejects(resolveCodexCommand({platform:'win32',env:{LOCALAPPDATA:f.root,PATH:'.;relative'}}),/codexCommand.*Notion 요청은 시작되지 않았습니다/);
});
