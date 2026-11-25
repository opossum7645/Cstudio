/** Minimal, complete parser for GDB/MI output records (GDB manual §27.2 "GDB/MI Output Syntax"). */

export type MIValue = string | MIValue[] | { [k: string]: MIValue };

export type MIRecord =
  | { kind: 'result'; token: number | null; cls: string; data: Record<string, MIValue> }
  | { kind: 'exec' | 'status' | 'notify'; token: number | null; cls: string; data: Record<string, MIValue> }
  | { kind: 'console' | 'target' | 'log'; text: string }
  | { kind: 'prompt' }
  | { kind: 'raw'; text: string };

class Reader {
  i = 0;
  constructor(public s: string) {}
  peek(): string {
    return this.s[this.i] ?? '';
  }
  eat(c: string): boolean {
    if (this.s[this.i] === c) {
      this.i++;
      return true;
    }
    return false;
  }
}

function parseCString(r: Reader): string {
  if (!r.eat('"')) throw new Error('expected "');
  let out = '';
  while (r.i < r.s.length) {
    const c = r.s[r.i++]!;
    if (c === '"') return out;
    if (c === '\\') {
      const n = r.s[r.i++] ?? '';
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') out += '\r';
      else if (n === 'e') out += '\x1b';
      else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(r.peek())) oct += r.s[r.i++];
        out += String.fromCharCode(parseInt(oct, 8));
      } else out += n;
    } else out += c;
  }
  throw new Error('unterminated string');
}

function parseValue(r: Reader): MIValue {
  const c = r.peek();
  if (c === '"') return parseCString(r);
  if (c === '{') {
    r.i++;
    const obj: Record<string, MIValue> = {};
    if (r.eat('}')) return obj;
    do {
      const [k, v] = parseResult(r);
      obj[k] = v;
    } while (r.eat(','));
    if (!r.eat('}')) throw new Error('expected }');
    return obj;
  }
  if (c === '[') {
    r.i++;
    const arr: MIValue[] = [];
    if (r.eat(']')) return arr;
    do {
      if (r.peek() === '"' || r.peek() === '{' || r.peek() === '[') arr.push(parseValue(r));
      else {
        const [k, v] = parseResult(r);
        arr.push({ [k]: v });
      }
    } while (r.eat(','));
    if (!r.eat(']')) throw new Error('expected ]');
    return arr;
  }
  throw new Error(`unexpected char ${c}`);
}

function parseResult(r: Reader): [string, MIValue] {
  const start = r.i;
  while (r.i < r.s.length && r.s[r.i] !== '=') r.i++;
  const key = r.s.slice(start, r.i);
  r.i++; // '='
  return [key, parseValue(r)];
}

export function parseMILine(line: string): MIRecord {
  if (line.startsWith('(gdb)')) return { kind: 'prompt' };
  try {
    const m = /^(\d*)([\^*+=~@&])/.exec(line);
    if (!m) return { kind: 'raw', text: line };
    const token = m[1] ? Number(m[1]) : null;
    const sym = m[2]!;
    const r = new Reader(line);
    r.i = m[0].length;
    if (sym === '~' || sym === '@' || sym === '&') {
      const text = parseCString(r);
      return { kind: sym === '~' ? 'console' : sym === '@' ? 'target' : 'log', text };
    }
    const clsStart = r.i;
    while (r.i < line.length && line[r.i] !== ',') r.i++;
    const cls = line.slice(clsStart, r.i);
    const data: Record<string, MIValue> = {};
    while (r.eat(',')) {
      const [k, v] = parseResult(r);
      data[k] = v;
    }
    const kind = sym === '^' ? 'result' : sym === '*' ? 'exec' : sym === '+' ? 'status' : 'notify';
    return { kind, token, cls, data };
  } catch {
    return { kind: 'raw', text: line };
  }
}

export const str = (v: MIValue | undefined): string => (typeof v === 'string' ? v : '');
export const list = (v: MIValue | undefined): MIValue[] => (Array.isArray(v) ? v : []);
export const tuple = (v: MIValue | undefined): Record<string, MIValue> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, MIValue>) : {};
