import type { Snippet } from '../types';

/** Built-in C snippet library (Monaco snippet syntax: $1, ${1:placeholder}, $0). */
export const BUILTIN_SNIPPETS: Snippet[] = [
  { id: 'b-main', prefix: 'main', name: 'main', description: 'Funzione main', body: '#include <stdio.h>\n\nint main(void) {\n\t$0\n\treturn 0;\n}', builtin: true },
  { id: 'b-mainargs', prefix: 'mainargs', name: 'main(argc, argv)', description: 'main con argomenti', body: 'int main(int argc, char *argv[]) {\n\t$0\n\treturn 0;\n}', builtin: true },
  { id: 'b-for', prefix: 'for', name: 'for', description: 'Ciclo for con indice', body: 'for (${1:int} ${2:i} = 0; $2 < ${3:n}; $2++) {\n\t$0\n}', builtin: true },
  { id: 'b-forr', prefix: 'forr', name: 'for inverso', description: 'Ciclo for decrescente', body: 'for (${1:int} ${2:i} = ${3:n} - 1; $2 >= 0; $2--) {\n\t$0\n}', builtin: true },
  { id: 'b-while', prefix: 'while', name: 'while', description: 'Ciclo while', body: 'while (${1:condizione}) {\n\t$0\n}', builtin: true },
  { id: 'b-do', prefix: 'do', name: 'do…while', description: 'Ciclo do-while', body: 'do {\n\t$0\n} while (${1:condizione});', builtin: true },
  { id: 'b-if', prefix: 'if', name: 'if', description: 'Istruzione if', body: 'if (${1:condizione}) {\n\t$0\n}', builtin: true },
  { id: 'b-ifelse', prefix: 'ifelse', name: 'if…else', description: 'if con else', body: 'if (${1:condizione}) {\n\t$2\n} else {\n\t$0\n}', builtin: true },
  { id: 'b-switch', prefix: 'switch', name: 'switch', description: 'Istruzione switch', body: 'switch (${1:espressione}) {\ncase ${2:valore}:\n\t$0\n\tbreak;\ndefault:\n\tbreak;\n}', builtin: true },
  { id: 'b-struct', prefix: 'struct', name: 'typedef struct', description: 'Struttura con typedef', body: 'typedef struct ${1:Nome} {\n\t${2:int campo;}\n} ${1:Nome};', builtin: true },
  { id: 'b-enum', prefix: 'enum', name: 'typedef enum', description: 'Enumerazione', body: 'typedef enum {\n\t${2:VALORE_A},\n\t${3:VALORE_B}\n} ${1:Nome};', builtin: true },
  { id: 'b-func', prefix: 'func', name: 'funzione', description: 'Definizione di funzione', body: '${1:int} ${2:nome}(${3:void}) {\n\t$0\n}', builtin: true },
  { id: 'b-guard', prefix: 'guard', name: 'header guard', description: 'Include guard per file .h', body: '#ifndef ${1:NOME_H}\n#define $1\n\n$0\n\n#endif /* $1 */', builtin: true },
  { id: 'b-inc', prefix: 'inc', name: '#include <…>', description: 'Include di sistema', body: '#include <${1:stdio}.h>', builtin: true },
  { id: 'b-incl', prefix: 'incl', name: '#include "…"', description: 'Include locale', body: '#include "${1:file}.h"', builtin: true },
  { id: 'b-printf', prefix: 'pf', name: 'printf', description: 'printf con newline', body: 'printf("${1:%d}\\n"${2:, valore});', builtin: true },
  { id: 'b-scanf', prefix: 'sf', name: 'scanf', description: 'scanf con controllo', body: 'if (scanf("${1:%d}", &${2:x}) != 1) {\n\tfprintf(stderr, "Input non valido\\n");\n\treturn 1;\n}', builtin: true },
  { id: 'b-malloc', prefix: 'malloc', name: 'malloc controllata', description: 'Allocazione con controllo NULL', body: '${1:int} *${2:p} = malloc(${3:n} * sizeof *$2);\nif ($2 == NULL) {\n\tperror("malloc");\n\treturn 1;\n}\n$0\nfree($2);', builtin: true },
  { id: 'b-fopen', prefix: 'fopen', name: 'fopen controllata', description: 'Apertura file con controllo', body: 'FILE *${1:fp} = fopen("${2:file.txt}", "${3:r}");\nif ($1 == NULL) {\n\tperror("fopen");\n\treturn 1;\n}\n$0\nfclose($1);', builtin: true },
  { id: 'b-ll', prefix: 'node', name: 'nodo lista', description: 'Nodo di lista concatenata', body: 'typedef struct ${1:Node} {\n\t${2:int} value;\n\tstruct $1 *next;\n} $1;', builtin: true },
];
