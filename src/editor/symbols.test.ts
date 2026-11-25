import { describe, it, expect } from 'vitest';
import { indexFile, SymbolIndex, stripCode } from './symbols';

const SRC = `#include <stdio.h>
#define MAX 10
#define SQ(x) ((x) * (x))

typedef struct Point {
    int x;
    int y;
} Point;

enum Color { RED, GREEN = 5, BLUE };

static int counter = 0;
const char *names[MAX];

int add(int a, int b);

/* comment with int fake(void) { } */
int add(int a, int b) {
    int sum = a + b; // "string int nope(void);"
    return sum;
}

Point make_point(int x, int y) {
    Point p = { x, y };
    return p;
}

int main(void) {
    int value = add(1, 2);
    Point pt = make_point(1, 2);
    for (int i = 0; i < MAX; i++) counter++;
    printf("%d %d\\n", value, pt.x);
    return 0;
}
`;

describe('symbol indexer', () => {
  const syms = indexFile('src/main.c', SRC);
  const find = (name: string, kind?: string) => syms.find((s) => s.name === name && (!kind || s.kind === kind));

  it('strips comments and strings but keeps offsets', () => {
    const s = stripCode('a /* b */ "c" // d\ne');
    expect(s.length).toBe('a /* b */ "c" // d\ne'.length);
    expect(s).not.toContain('b');
    expect(s.endsWith('\ne')).toBe(true);
  });

  it('finds macros, typedefs, structs, enums', () => {
    expect(find('MAX', 'macro')?.line).toBe(2);
    expect(find('SQ', 'macro')?.detail).toContain('SQ(x)');
    expect(find('Point', 'typedef')).toBeTruthy();
    expect(find('Point', 'struct')?.line).toBe(5);
    expect(find('Color', 'enum')).toBeTruthy();
    expect(find('GREEN', 'enumerator')?.detail).toContain('= 5');
  });

  it('finds functions, prototypes and ignores code in comments/strings', () => {
    expect(find('add', 'prototype')?.line).toBe(15);
    const def = find('add', 'function');
    expect(def?.line).toBe(18);
    expect(def?.detail).toBe('int add(int a, int b)');
    expect(def?.endLine).toBe(21);
    expect(find('make_point', 'function')?.detail).toContain('Point make_point');
    expect(find('main', 'function')).toBeTruthy();
    expect(find('fake')).toBeUndefined();
    expect(find('nope')).toBeUndefined();
  });

  it('finds globals, locals and parameters with scope', () => {
    expect(find('counter', 'variable')).toBeTruthy();
    expect(find('names', 'variable')).toBeTruthy();
    expect(find('sum', 'local')?.scope).toBe('add');
    expect(find('pt', 'local')?.scope).toBe('main');
    expect(find('i', 'local')?.scope).toBe('main');
    expect(syms.filter((s) => s.name === 'a' && s.kind === 'parameter').length).toBe(1);
    expect(find('x', 'local')).toBeUndefined(); // struct members are not variables
  });

  it('resolves definitions across files and visibility', () => {
    const idx = new SymbolIndex();
    idx.update('include/f.h', 'typedef unsigned long ulong;\nulong twice(ulong v);\n');
    idx.update('src/f.c', '#include "f.h"\nulong twice(ulong v) {\n  ulong r = v * 2;\n  return r;\n}\n');
    expect(idx.definition('twice')?.file).toBe('src/f.c');
    expect(idx.definition('ulong')?.kind).toBe('typedef');
    expect(idx.visibleAt('src/f.c', 4).some((s) => s.name === 'r')).toBe(true);
    expect(idx.visibleAt('src/f.c', 1).some((s) => s.name === 'r')).toBe(false);
  });
});
