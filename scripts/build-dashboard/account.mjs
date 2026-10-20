import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolveCodexCommand} from './codex-command.mjs';

export function safeAccount(account, limits) {
  const buckets=Object.values(limits?.rateLimitsByLimitId||{});
  if(!buckets.length&&limits?.rateLimits)buckets.push(limits.rateLimits);
  return {connected:!!account,type:account?.type||null,email:account?.email||'',plan:account?.planType||'',windows:buckets.flatMap(b=>
    ['primary','secondary'].filter(k=>b[k]).map(k=>({name:b.limitName||b.limitId||'Codex',minutes:b[k].windowDurationMins,
      remaining:Number.isFinite(b[k].usedPercent)?Math.max(0,Math.min(100,100-b[k].usedPercent)):null,
      resetsAt:b[k].resetsAt??null})))};
}
async function client(command,onNotice=()=>{}) {
  const exe=/^codex(?:\.exe)?$/i.test(command)?await resolveCodexCommand():command;
  const child=spawn(exe,['app-server'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let seq=0;const pending=new Map();
  const stop=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Codex 연결이 종료되었습니다.'));}pending.clear();};
  child.on('error',stop);child.on('exit',stop);child.stderr.resume();
  child.stdin.on('error',()=>{});
  createInterface({input:child.stdout}).on('line',line=>{
    let msg;try{msg=JSON.parse(line);}catch{return;}
    const p=pending.get(msg.id);
    if(p){clearTimeout(p.timer);pending.delete(msg.id);msg.error?p.reject(new Error('Codex 계정 조회 요청을 처리하지 못했습니다.')):p.resolve(msg.result);}
    else if(msg.method)onNotice(msg);
  });
  const send=msg=>child.stdin.write(JSON.stringify(msg)+'\n');
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Codex 응답 시간이 초과되었습니다.'));},20000);
    pending.set(id,{resolve,reject,timer});send({id,method,params});
  });
  const close=()=>{stop();child.kill();};
  try{await call('initialize',{clientInfo:{name:'sirius_build_dashboard',version:'1.0.0'}});send({method:'initialized'});}
  catch(error){close();throw error;}
  return {call,close};
}
export function createAccountService(command) {
  let login=null,last={connected:false,windows:[],error:'아직 조회하지 않았습니다.'},cachedAt=0,inflight;
  async function read(force=false){
    if(!force&&Date.now()-cachedAt<60000)return {...last,loginPending:!!login};
    if(inflight)return inflight;
    inflight=(async()=>{
      let rpc;
      try{
        rpc=await client(command);const {account}=await rpc.call('account/read',{refreshToken:false});
        let limits,error='';
        if(account?.type==='chatgpt')try{limits=await rpc.call('account/rateLimits/read');}catch{error='사용량을 조회하지 못했습니다. 다시 조회해 주세요.';}
        last={...safeAccount(account,limits),error,checkedAt:new Date().toISOString()};
      }catch{last={connected:false,windows:[],error:'계정 정보를 조회하지 못했습니다. Codex 로그인 상태를 확인해 주세요.'};}
      finally{rpc?.close();cachedAt=Date.now();inflight=null;}
      return {...last,loginPending:!!login};
    })();return inflight;
  }
  async function cancel(){
    const old=login;login=null;
    if(old){clearTimeout(old.timer);try{await old.rpc?.call('account/login/cancel',{loginId:old.id});}finally{old.rpc?.close();}}
    cachedAt=0;
  }
  async function start(){
    if(login)throw new Error('이미 로그인이 진행 중입니다.');
    const pending={};login=pending;
    try{
      pending.rpc=await client(command,msg=>{
        if(msg.method==='account/login/completed'&&login===pending){
          clearTimeout(pending.timer);login=null;cachedAt=0;pending.rpc?.close();
        }
      });
      const result=await pending.rpc.call('account/login/start',{type:'chatgpt'});
      const url=new URL(result.authUrl);
      if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com','auth.chatgpt.com'].includes(url.hostname))throw new Error('공식 로그인 주소를 확인할 수 없습니다.');
      pending.id=result.loginId;pending.timer=setTimeout(()=>{cancel().catch(()=>{});},300000);
      return {authUrl:url.href};
    }catch(error){pending.rpc?.close();login=null;throw error;}
  }
  return {read,start,cancel,get pending(){return !!login;}};
}
