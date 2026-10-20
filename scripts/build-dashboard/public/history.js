export function resultKey(job) {
  return `${job.id}:${job.status}:${job.finishedAt || ''}`;
}
export function currentJob(jobs, activeId, seen = new Set()) {
  const running=jobs.find(job => job.id === activeId && job.status === 'running') ||
    jobs.find(job => job.status === 'running');
  if(running)return running;
  const latest=selectJobs(jobs)[0];
  return latest && !seen.has(resultKey(latest)) ? latest : undefined;
}
export function filterRecords(records, product, legacyProduct) {
  return records.filter(record => product==='all' || (record.product || legacyProduct)===product);
}
export function sortReleases(records, order='high') {
  return [...records].sort((a,b)=>{
    const av=String(a.version).replace(/^v/i,'').split('.').map(Number);
    const bv=String(b.version).replace(/^v/i,'').split('.').map(Number);
    for(let i=0;i<3;i++){const diff=(av[i]||0)-(bv[i]||0);if(diff)return (order==='low'?1:-1)*diff;}
    return 0;
  });
}
export function buildTags(job,jobs,currentVersion){
  const latest=selectJobs(jobs.filter(j=>j.product===job.product&&j.status==='succeeded'))[0];
  if(latest?.id!==job.id)return [];
  return [
    ...(String(currentVersion||'').replace(/^v/i,'')===String(job.currentVersion||'').replace(/^v/i,'')?['현재 버전']:[]),
    '최근 성공 빌드'
  ];
}
export function quotaDisplay(window,failed=false){
  const available=!failed&&Number.isFinite(window?.remaining);
  return {available,text:available?`${window.remaining}% 남음`:'조회 불가'};
}

export function selectJobs(jobs, status = 'all', order = 'newest') {
  const errors = ['failed', 'partial', 'interrupted'];
  return jobs.filter(job => status === 'all' ||
    (status === 'error' ? errors.includes(job.status) : job.status === status))
    .sort((a, b) => {
      const aTime = Date.parse(a.startedAt), bTime = Date.parse(b.startedAt);
      if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? 1 : 0;
      if (!Number.isFinite(bTime)) return -1;
      return (order === 'oldest' ? 1 : -1) * (aTime - bTime);
    });
}
