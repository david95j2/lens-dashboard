import path from 'node:path';
import { stat, readdir } from 'node:fs/promises';

// Resolve at each launch: the desktop app's versioned bin directory can change on update.
export async function resolveCodexCommand({env = process.env, platform = process.platform} = {}) {
  const name = platform === 'win32' ? 'codex.exe' : 'codex';
  const isFile = async file => { try { return (await stat(file)).isFile(); } catch { return false; } };
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  for (const entry of searchPath.split(platform === 'win32' ? ';' : ':')) {
    const directory = entry.replace(/^"|"$/g, '');
    if (!path.isAbsolute(directory)) continue; // Do not search the repository/current directory.
    const candidate = path.join(directory, name);
    if (await isFile(candidate)) return candidate;
  }
  const local = env.LOCALAPPDATA;
  if (platform === 'win32' && local && path.isAbsolute(local)) {
    const base = path.join(local, 'OpenAI', 'Codex', 'bin');
    if (await isFile(path.join(base, name))) return path.join(base, name);
    let entries = [];
    try { entries = await readdir(base, {withFileTypes:true}); } catch {}
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(base, entry.name, name);
      if (await isFile(file)) candidates.push({file, modified:(await stat(path.dirname(file))).mtimeMs});
    }
    candidates.sort((a,b) => b.modified-a.modified || a.file.localeCompare(b.file));
    if (candidates.length) return candidates[0].file;
  }
  throw new Error('Codex 실행 파일을 찾지 못했습니다. Codex 앱을 실행·업데이트한 뒤 다시 시도하거나 scripts/build-dashboard/settings.json의 codexCommand에 실행 파일 전체 경로를 지정하세요. Notion 요청은 시작되지 않았습니다.');
}
