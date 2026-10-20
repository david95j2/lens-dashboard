import http from 'node:http';
import {createAccountService} from './account.mjs';
import {createRecordEdits,releaseKey} from './record-edits.mjs';
import {validateRepository} from './repositories.mjs';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, readdir, access } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUpgrade, makePrompt } from './workflow.mjs';
import { promoteLensPackage } from './latest-package.mjs';
import { resolveCodexCommand } from './codex-command.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const dashboardRoot = path.resolve(here, '../..');
const defaultConfig = JSON.parse(await readFile(path.join(here, 'settings.json'), 'utf8'));
export const lensRoot = path.resolve(defaultConfig.lensPath);
const now = () => new Date().toISOString();
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
export async function run(command, args, { cwd, input, onData = () => {}, onSpawn = () => {}, timeout = 7200000 } = {}) {
  if (/^codex(?:\.exe)?$/i.test(command)) command = await resolveCodexCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe'] });
    onSpawn(child.pid);
    let output = '', timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Only terminate the process tree created by this job, never unrelated dotnet instances.
      if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide:true });
      else child.kill('SIGTERM');
    }, timeout);
    const append = chunk => { const text = chunk.toString(); output = (output + text).slice(-2000000); onData(text); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 && !timedOut ? resolve(output) : reject(new Error(timedOut ? '실행 제한 시간을 초과했습니다.' : `${command} 종료 코드 ${code}\n${output.slice(-5000)}`)); });
    child.stdin.on('error', () => {}); child.stdin.end(input || '');
  });
}
const git = (repo, args) => run('git', ['-c','core.quotepath=false', ...args], {cwd:repo, timeout:20000}).then(v=>v.trim());
export async function productState(id, config) {
  const repo = id === 'lens' ? (config.lensPath||lensRoot) : config.installerPath;
  try {
    const [head, branch, changes, latest, tags] = await Promise.all([
      git(repo,['rev-parse','HEAD']), git(repo,['branch','--show-current']), git(repo,['status','--short','--untracked-files=all']),
      git(repo,['log','-1','--format=%s']), git(repo,['tag','--points-at','HEAD'])
    ]);
    const version = id === 'lens'
      ? (await readFile(path.join(repo,'src/SiriusLens.App/SiriusLens.App.csproj'),'utf8')).match(/<Version>([^<]+)<\/Version>/)?.[1]
      : JSON.parse(await readFile(path.join(repo,'LensInstaller/SiriusApi.json'),'utf8')).installerVersion;
    return {id, name:id === 'lens' ? 'SIRIUS LENS' : 'LENS Installer', repo, version, head, branch, changes, latest, tags};
  } catch(error) { return {id, repo, error:error.message}; }
}
async function fingerprint(repo) {
  const hash = createHash('sha256');
  hash.update(await git(repo,['rev-parse','HEAD']));
  hash.update(await git(repo,['diff','HEAD','--binary']));
  const files = await git(repo,['ls-files','--others','--exclude-standard','-z']);
  for (const name of files.split('\0').filter(Boolean).sort()) {
    hash.update(name); hash.update(await readFile(path.join(repo,name)));
  }
  return hash.digest('hex');
}
export async function openFolder(folder) {
  await access(folder);
  await new Promise((resolve,reject)=>{
    const child=spawn(path.join(process.env.SystemRoot || 'C:\\Windows','explorer.exe'),[folder],{shell:false});
    child.once('error',reject);
    child.once('spawn',resolve);
  });
}
export async function createDashboard({config = {...defaultConfig}, configFile=path.join(here,'settings.json'), dataRoot = path.join(dashboardRoot,'artifacts/dashboard'), execute = run, promote = promoteLensPackage, inspect = id => productState(id,config), open = openFolder} = {}) {
  let lensRoot=path.resolve(config.lensPath||defaultConfig.lensPath),linking=false,picking=false;
  const brandingRoot=path.resolve(defaultConfig.lensPath);
  const accounts=createAccountService(config.codexCommand||'codex.exe');
  const recordEdits=createRecordEdits(dataRoot);
  await mkdir(dataRoot,{recursive:true});
  const jobs = [];
  for (const name of await readdir(dataRoot)) {
    if (!/^[a-f0-9-]{36}$/.test(name)) continue;
    try {
      const job = JSON.parse(await readFile(path.join(dataRoot,name,'job.json'),'utf8'));
      // Preserve pre-link history paths before allowing any repository change.
      job.repo ||= job.product==='lens'?lensRoot:config.installerPath;
      if (job.status === 'running') {
        if (job.childPid && alive(job.childPid)) throw new Error(`이전 작업 ${job.id}의 프로세스가 실행 중입니다. 기존 대시보드를 확인하세요.`);
        job.status='interrupted'; job.summary='서버가 종료되어 작업 결과를 확인해야 합니다. 변경·커밋 및 Notion 기록을 확인한 후 계속하세요.';
      }
      jobs.push(job);
    } catch(error) { if (error.message.startsWith('이전 작업')) throw error; }
  }
  jobs.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  let active = null;
  const token = randomBytes(32).toString('hex');
  let persistence = Promise.resolve();
  const persist = job => {
    const target = path.join(dataRoot,job.id,'job.json');
    const snapshot = JSON.stringify(job,null,2);
    persistence = persistence.then(async()=>{
      await writeFile(target+'.tmp',snapshot); await rename(target+'.tmp',target);
    });
    return persistence;
  };
  async function perform(job) {
    const folder = path.join(dataRoot,job.id), repo = job.repo || (job.product === 'lens' ? lensRoot : config.installerPath);
    let log = '';
    const opts = {cwd:repo, onData:text=>{
      log=(log+text).slice(-180000); job.log=log;
      const stage=[...log.matchAll(/^STAGE: (.+)\r?$/gm)].at(-1)?.[1].trim();
      const stages={installer:'설치·제거 파일 빌드 중', 'protected-build':'보호 빌드 및 회귀 검증 중',signing:'EXE 서명·검증 중 · 인증 요청을 확인하세요',zip:'SiriusLens 폴더 ZIP 압축 중'};
      if(stage && stages[stage]) job.summary=stages[stage];
    },
      onSpawn:pid=>{job.childPid=pid;void persist(job).catch(()=>{});}};
    try {
      if (job.action === 'connect') {
        let registered = false;
        let existing;
        try { existing=await execute(config.codexCommand,['mcp','get','lens-notion','--json'],{...opts,timeout:15000}); } catch {}
        if (existing) {
          const serverConfig=JSON.parse(existing);
          if (serverConfig.transport?.url !== 'https://mcp.notion.com/mcp') throw new Error('lens-notion 서버 주소가 공식 Notion 주소와 다릅니다. CLI 설정을 확인하세요.');
          registered=true;
        }
        // add performs initial OAuth when supported; login handles previously registered connections.
        await execute(config.codexCommand, registered ? ['mcp','login','lens-notion'] : ['mcp','add','lens-notion','--url','https://mcp.notion.com/mcp'], {...opts,timeout:600000});
        job.summary='Notion 연결 절차 완료. 실제 데이터 접근은 커밋 작업 시작 시 다시 확인합니다.';
      } else if (job.action === 'build') {
        const source=await inspect(job.product);
        if(source.error || source.head!==job.baseHead || source.version!==job.currentVersion) throw new Error('빌드 시작 전 소스 상태가 변경되었습니다. 다시 실행하세요.');
        job.sourceDirty=!!source.changes;
        job.sourceChanges=source.changes;
        job.sourceSubject=source.latest;
        const before = await fingerprint(repo);
        job.sourceFingerprint=before;
        await persist(job);
        const output = await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(here,'publish.ps1'),
          '-Product',job.product,'-LensRoot',lensRoot,'-InstallerRoot',config.installerPath,'-OutputRoot',folder,'-WorkRoot',dashboardRoot,'-KeyAlias',config.signingKeyAlias],opts);
        const result = output.match(/^RESULT: (.+)\r?$/m)?.[1].trim();
        if (!result || (job.product==='installer'
          ? path.resolve(result)!==path.resolve(config.installerPath,'publish')
          : !path.resolve(result).startsWith(folder+path.sep))) throw new Error('빌드 결과 경로를 확인하지 못했습니다.');
        await access(result);
        job.output = result;
        if (before !== await fingerprint(repo)) {
          throw new Error('빌드 중 소스가 변경되었습니다. 생성 파일은 배포하지 말고 다시 빌드하세요.');
        }
        if(job.product==='lens') {
          job.summary='검증된 최신 배포 폴더 갱신 중';
          job.latestOutput=await promote(lensRoot,folder,result,{jobId:job.id,version:job.currentVersion,commit:job.baseHead,
            sourceDirty:job.sourceDirty,sourceFingerprint:before,builtAt:now()},config.lensArchivePath,dataRoot);
          job.output=job.latestOutput;
          if(config.lensArchivePath)job.archiveOutput=path.resolve(config.lensArchivePath,job.id);
        }
        job.summary = job.product === 'lens' ? '보호 빌드·EXE 서명 검증·ZIP 구조 확인 완료. 실제 화면 확인은 별도입니다.' : '설치/제거 EXE 게시 완료. API 설정은 인스톨러에 내장되어 있습니다.';
      } else {
        // The runner keeps normal sandboxing and automatic approval review enabled.
        // Source/Git/Notion operations are authorized by the corresponding dashboard button.
        const outputFile = path.join(folder,'agent-result.json');
        await writeFile(path.join(folder,'request.txt'),makePrompt(job,config,repo));
        try {
          await execute(config.codexCommand,['exec',...(job.model ? ['--model',job.model] : []),'-c',`model_reasoning_effort="${job.effort}"`,'--approve-for-me','--json','--color','never','-C',repo,
            '--add-dir',folder,'--output-schema',path.join(here,'agent-result.schema.json'),'-o',outputFile,'-'],
            {...opts,input:makePrompt(job,config,repo)});
        } finally {
          const head = await git(repo,['rev-parse','HEAD']);
          if (head !== job.baseHead) job.commit = head;
          try {
            const result = JSON.parse(await readFile(outputFile,'utf8'));
            job.summary=result.summary; job.taskUrl=result.taskUrl; job.versionUrl=result.versionUrl;
            job.agentCompleted=result.completed;
            if (result.commit && /^[a-f0-9]{40}$/.test(result.commit)) job.commit=result.commit;
          } catch {}
        }
        if (!job.agentCompleted) throw new Error(job.summary || '작업 완료를 확인하지 못했습니다. 실행 기록을 확인하세요.');
        if (!job.commit || !job.taskUrl || !job.versionUrl) throw new Error('커밋 또는 Notion 결과 링크가 누락되었습니다.');
        if (job.action === 'sync' ? job.commit !== job.existingCommit : job.commit === job.baseHead || job.commit !== await git(repo,['rev-parse','HEAD'])) throw new Error('요청한 작업의 커밋을 확인할 수 없습니다. Git 기록을 확인하세요.');
        await git(repo,['cat-file','-e',`${job.commit}^{commit}`]);
        if (job.action === 'version') {
          const current = await inspect(job.product);
          if (current.version !== job.options.version || current.changes) throw new Error('버전 변경 후 소스 상태를 확인해야 합니다.');
        }
      }
      job.status='succeeded';
    } catch(error) {
      job.status = job.commit ? 'partial' : 'failed';
      job.summary = error.message.slice(-6000);
    } finally {
      job.finishedAt=now(); delete job.childPid;
      await writeFile(path.join(folder,'output.log'),log);
      await persist(job); active=null;
    }
  }
  async function start(body) {
    if (active||linking) throw new Error('작업 또는 프로젝트 연결이 진행 중입니다.');
    if (!['lens','installer'].includes(body.product) || !['build','commit','version','connect','sync'].includes(body.action)) throw new Error('지원하지 않는 작업입니다.');
    const state = await inspect(body.product);
    if (active||linking) throw new Error('작업 또는 프로젝트 연결이 진행 중입니다.');
    if (state.error) throw new Error(state.error);
    const options = {version:String(body.version || '').trim(), assignee:String(body.assignee || '').slice(0,150), issues:String(body.issues || '').slice(0,2000)};
    if (body.action === 'version' && (!isUpgrade(options.version,state.version) || state.changes)) throw new Error('버전 업그레이드는 변경 사항을 먼저 커밋한 뒤, 현재보다 높은 x.y.z 버전으로 실행하세요.');
    if (body.action === 'commit' && !state.changes) throw new Error('커밋할 변경 사항이 없습니다.');
    const original = body.action === 'sync' ? jobs.find(j=>j.id===body.jobId && j.commit && j.product===body.product) : null;
    if (body.action === 'sync' && !original) throw new Error('재연결할 기존 커밋을 찾을 수 없습니다.');
    if(original?.repo&&path.resolve(original.repo)!==path.resolve(state.repo|| (body.product==='lens'?lensRoot:config.installerPath)))throw new Error('이 작업의 원래 저장소를 다시 연결한 뒤 Notion 재시도를 진행하세요.');
    const agentAction=['commit','version','sync'].includes(body.action);
    const model=String(body.model ?? original?.model ?? '').trim();
    const effort=String(body.effort ?? original?.effort ?? 'low');
    if(agentAction && (model && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(model) || !['low','medium','high','xhigh'].includes(effort))) throw new Error('모델 이름 또는 추론 강도를 확인하세요.');
    const lensState=agentAction && body.product==='installer' ? await inspect('lens') : state;
    if(agentAction && (!lensState.version || lensState.error)) throw new Error('Notion에 연결할 LENS 버전을 확인할 수 없습니다.');
    const notionVersion=original?.notionVersion || (body.product==='installer' ? lensState.version : options.version || state.version);
    if (active||linking) throw new Error('작업 또는 프로젝트 연결이 진행 중입니다.');
    const job = {id:randomUUID(),product:body.product,action:body.action,options,status:'running',startedAt:now(),
      ...(agentAction ? {model,effort,notionVersion,workStartedAt:original?.workStartedAt || original?.startedAt || now()} : {}),
      repo:state.repo || (body.product==='lens'?lensRoot:config.installerPath),
      baseHead:state.head,currentVersion:state.version,summary:'작업을 시작합니다.',log:'',
      ...(original ? {existingCommit:original.commit,commit:original.commit,originJob:original.id,options:original.options} : {})};
    active=job; jobs.unshift(job);
    try { await mkdir(path.join(dataRoot,job.id)); await persist(job); }
    catch(error) { active=null; jobs.shift(); throw error; }
    void perform(job).catch(error=>{job.status='failed';job.summary=error.message;active=null;});
    return job;
  }
  const server = http.createServer(async (req,res) => {
    const host = `127.0.0.1:${server.address().port}`;
    const reply = (status,body,type='application/json; charset=utf-8') => {
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
      res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') return reply(403,{error:'이 PC의 대시보드에서만 요청할 수 있습니다.'});
    try {
      const url = new URL(req.url,`http://${host}`);
      if(req.method==='GET'&&url.pathname==='/api/account')return reply(200,await accounts.read());
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const products = await Promise.all(['lens','installer'].map(inspect));
        const releases = JSON.parse(await readFile(path.join(here,'releases.json'),'utf8'));
        return reply(200,{token,products,releases,recordEdits:await recordEdits.read(),active:active?.id,notion:config.notion,jobs:jobs.map(({log,...job})=>job),
          builds:jobs.filter(j=>j.action==='build').map(({log,...job})=>job)});
      }
      if (req.method === 'GET' && url.pathname === '/api/log') {
        const job=jobs.find(j=>j.id===url.searchParams.get('id'));
        return reply(job?200:404,job?{log:job.log || '',summary:job.summary}:{error:'작업을 찾을 수 없습니다.'});
      }
      if (req.method === 'POST') {
        if (req.headers['x-dashboard-token'] !== token || !req.headers['content-type']?.startsWith('application/json')) return reply(403,{error:'대시보드를 새로고침하세요.'});
        let raw=''; for await(const chunk of req) {raw+=chunk; if(raw.length>8192) {reply(413,{error:'요청이 너무 큽니다.'}); return;} }
        const body=JSON.parse(raw);
        if(url.pathname==='/api/repository/pick'){
          if(picking)throw new Error('폴더 선택 창이 이미 열려 있습니다.');
          picking=true;
          try{
            const result=await run('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(here,'select-folder.ps1')],{timeout:300000});
            return reply(200,{path:result.trim()?Buffer.from(result.trim(),'base64').toString('utf8'):null});
          }finally{picking=false;}
        }
        if(url.pathname==='/api/repository/check')return reply(200,await validateRepository(body.product,body.path,git));
        if(url.pathname==='/api/repository/link'){
          if(active||linking||accounts.pending)throw new Error('현재 작업이나 로그인이 끝난 후 연결을 변경하세요.');
          linking=true;
          try{
            const result=await validateRepository(body.product,body.path,git);
            const key=body.product==='lens'?'lensPath':'installerPath';
            if(body.expectedPath!==config[key])throw new Error('연결 정보가 변경되었습니다. 창을 다시 열어 주세요.');
            const saved=JSON.parse(await readFile(configFile,'utf8'));
            if(saved[key]!==config[key])throw new Error('설정 파일이 변경되었습니다. 서버 재시작 후 다시 연결하세요.');
            // Persist historical repositories before replacing the default path.
            for(const job of jobs)await persist(job);
            saved[key]=result.repo;
            await writeFile(configFile+'.tmp',JSON.stringify(saved,null,2)+'\n');await rename(configFile+'.tmp',configFile);
            config[key]=result.repo;if(body.product==='lens')lensRoot=result.repo;
            return reply(200,result);
          }finally{linking=false;}
        }
        if(url.pathname==='/api/account/refresh')return reply(200,await accounts.read(true));
        if(url.pathname==='/api/account/cancel'){await accounts.cancel();return reply(200,{ok:true});}
        if(url.pathname==='/api/account/login'){
          if(active||linking)throw new Error('현재 작업 또는 프로젝트 연결이 끝난 후 계정을 변경하세요.');
          return reply(200,await accounts.start());
        }
        if(url.pathname==='/api/records/edit'){
          const releases=JSON.parse(await readFile(path.join(here,'releases.json'),'utf8'));
          await recordEdits.save(body,[...releases.map(releaseKey),...jobs.filter(j=>j.action==='build'&&j.status!=='running').map(j=>'build:'+j.id)]);
          return reply(200,{ok:true});
        }
        if(url.pathname==='/api/jobs'&&accounts.pending)throw new Error('계정 로그인을 완료하거나 취소한 뒤 실행하세요.');
        if (url.pathname === '/api/jobs') return reply(202,await start(body));
        if (url.pathname === '/api/open') {
          const job=jobs.find(j=>j.id===body.id);
          if (!job) throw new Error('작업을 찾을 수 없습니다.');
          const folder=body.latest && job.product==='lens' && job.status==='succeeded' && job.latestOutput
            ? path.join(job.repo||lensRoot,'publish')
            : job.action==='build' && job.status==='succeeded'
              ? job.product==='installer' ? path.resolve(job.repo||config.installerPath,'publish')
                : job.archiveOutput || path.join(dataRoot,job.id)
              : path.join(dataRoot,job.id);
          try { await open(folder); }
          catch(error) { throw new Error(`폴더를 열지 못했습니다 (${error.code || '실행 오류'}). 경로: ${folder}`); }
          return reply(200,{ok:true});
        }
      }
      if(req.method==='GET'&&url.pathname==='/branding/edit.svg')return reply(200,await readFile(path.join(brandingRoot,'src/SiriusLens.App/Resources/Icons/Edit.svg')),'image/svg+xml');
      if(req.method==='GET'&&url.pathname==='/branding/folder-open.svg')return reply(200,await readFile(path.join(brandingRoot,'src/SiriusLens.App/Resources/Icons/Folder-open.svg')),'image/svg+xml');
      if(req.method==='GET'&&url.pathname==='/link.svg')return reply(200,await readFile(path.join(here,'public/link.svg')),'image/svg+xml');
      if(req.method==='GET'&&url.pathname==='/memo-pad-duotone-light-full.svg')return reply(200,await readFile(path.join(here,'public/memo-pad-duotone-light-full.svg')),'image/svg+xml');
      const branding={'/branding/lens.png':['LENS.png','image/png'],'/branding/sirius.svg':['Logo-LightGray.svg','image/svg+xml']};
      if(req.method==='GET' && branding[url.pathname]) {
        const [file,type]=branding[url.pathname];
        return reply(200,await readFile(path.join(brandingRoot,'src/SiriusLens.App/Resources/Branding',file)),type);
      }
      const pages={'/':'index.html','/app.js':'app.js','/extras.js':'extras.js','/history.js':'history.js','/style.css':'style.css'};
      if (req.method==='GET' && pages[url.pathname]) return reply(200,await readFile(path.join(here,'public',pages[url.pathname])),url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html; charset=utf-8');
      return reply(404,{error:'찾을 수 없습니다.'});
    } catch(error) { reply(400,{error:error.message}); }
  });
  return {server,jobs};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!Number.isInteger(defaultConfig.port) || defaultConfig.port < 1024 || defaultConfig.port > 65535) throw new Error('port must be between 1024 and 65535.');
  const {server} = await createDashboard();
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(defaultConfig.port,'127.0.0.1',()=>{
    const url=`http://127.0.0.1:${defaultConfig.port}`;
    console.log(`Local: ${url}`);
    if(process.argv.includes('--open')) spawn('powershell.exe',['-NoProfile','-Command',`Start-Process '${url}'`],{windowsHide:true}).on('error',error=>console.error(error.message));
  });
}
