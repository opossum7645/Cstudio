type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min: Level = (process.env.CSTUDIO_LOG as Level) ?? 'info';

function log(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (order[level] < order[min]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const logger = {
  debug: (m: string, e?: Record<string, unknown>) => log('debug', m, e),
  info: (m: string, e?: Record<string, unknown>) => log('info', m, e),
  warn: (m: string, e?: Record<string, unknown>) => log('warn', m, e),
  error: (m: string, e?: Record<string, unknown>) => log('error', m, e),
};
