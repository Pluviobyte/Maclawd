import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const expand = path => path === '~' ? homedir() : /^~[\\/]/.test(path) ? join(homedir(), path.slice(2)) : path;
const unique = paths => [...new Set(paths.filter(Boolean).map(path => {
  const full = expand(path.trim());
  try { return realpathSync(full); } catch { return full; }
}))];
const isOmp = dir => /[\\/]\.omp(?:[\\/]|$)/.test(dir)
  || existsSync(join(dir, 'config.yml')) || existsSync(join(dir, 'agent.db'));

export function piSessionDirs() {
  if (process.env.MACLAWD_PI_DIR?.trim()) return unique([process.env.MACLAWD_PI_DIR]);
  const agent = expand(process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), '.pi', 'agent'));
  if (process.env.PI_CODING_AGENT_DIR && isOmp(agent)) return [];
  let configured;
  try {
    const value = JSON.parse(readFileSync(join(agent, 'settings.json'), 'utf8')).sessionDir;
    if (typeof value === 'string' && (isAbsolute(value) || /^~[\\/]/.test(value))) configured = value;
  } catch { /* 无设置时使用默认路径，不读取 auth.json。 */ }
  return unique([join(agent, 'sessions'), process.env.PI_CODING_AGENT_SESSION_DIR?.trim(), configured]);
}

export function ompSessionDirs() {
  if (process.env.MACLAWD_OMP_DIR?.trim()) return unique([process.env.MACLAWD_OMP_DIR]);
  const config = expand(process.env.PI_CONFIG_DIR?.trim() || '.omp');
  const root = isAbsolute(config) ? config : join(homedir(), config);
  const dirs = [join(root, 'agent', 'sessions')];
  const profiles = (base, nested) => {
    try {
      for (const entry of readdirSync(join(base, 'profiles'), { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(join(base, 'profiles', entry.name, ...(nested ? ['agent'] : []), 'sessions'));
      }
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
  };
  profiles(root, true);
  const agent = process.env.PI_CODING_AGENT_DIR?.trim();
  if (agent && isOmp(expand(agent))) dirs.push(join(expand(agent), 'sessions'));
  if (process.env.XDG_DATA_HOME?.trim()) {
    const xdg = join(expand(process.env.XDG_DATA_HOME.trim()), 'omp');
    dirs.push(join(xdg, 'sessions')); profiles(xdg, false);
  }
  return unique(dirs);
}
