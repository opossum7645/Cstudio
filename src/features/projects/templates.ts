/** Project templates and example programs. All code here is real, compilable C. */
import type { BuildConfig } from '../../types';

export const defaultDebugConfig: BuildConfig = {
  compiler: 'gcc',
  std: 'c17',
  optimization: 'O0',
  mode: 'debug',
  warnings: { all: true, extra: true, pedantic: false, asErrors: false },
  debugInfo: true,
  defines: [],
  libraries: [],
  extraFlags: [],
  sanitizeUndefined: false,
};

export function releaseFrom(debug: BuildConfig): BuildConfig {
  return { ...debug, mode: 'release', optimization: 'O2', debugInfo: false, warnings: { ...debug.warnings }, defines: [...debug.defines], libraries: [...debug.libraries], extraFlags: [...debug.extraFlags] };
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  files: Record<string, string>;
  folders: string[];
  libraries?: string[];
  open: string[];
}

const readme = (title: string, body: string) => `# ${title}

${body}

## Struttura

- \`src/\` — sorgenti \`.c\`
- \`include/\` — header \`.h\`
- \`build/\` — output della compilazione (gestito da C-Studio)

## Compilazione

Configurazione Debug predefinita, equivalente a:

\`\`\`
gcc -std=c17 -Wall -Wextra -O0 -g src/*.c -Iinclude -o build/app
\`\`\`
`;

const HELLO = `#include <stdio.h>

int main(void) {
    printf("Hello, World!\\n");
    return 0;
}
`;

const CONSOLE = `#include <stdio.h>
#include <string.h>

#define MAX_NAME 64

int main(void) {
    char name[MAX_NAME];

    printf("Come ti chiami? ");
    if (fgets(name, sizeof name, stdin) == NULL) {
        fprintf(stderr, "Nessun input ricevuto.\\n");
        return 1;
    }
    name[strcspn(name, "\\n")] = '\\0';

    printf("Ciao, %s! Benvenuto in C-Studio.\\n", name[0] ? name : "programmatore");
    return 0;
}
`;

const CALC = `#include <stdio.h>

static int calcola(double a, char op, double b, double *risultato) {
    switch (op) {
    case '+': *risultato = a + b; return 0;
    case '-': *risultato = a - b; return 0;
    case '*': *risultato = a * b; return 0;
    case '/':
        if (b == 0.0) return -1;
        *risultato = a / b;
        return 0;
    default:
        return -2;
    }
}

int main(void) {
    double a, b, r;
    char op;

    printf("Calcolatrice — scrivi un'operazione (es. 3 * 4), q per uscire\\n");
    for (;;) {
        printf("> ");
        if (scanf(" %lf %c %lf", &a, &op, &b) != 3) {
            if (scanf(" %c", &op) == 1 && op == 'q') break;
            printf("Input non valido.\\n");
            int c;
            while ((c = getchar()) != '\\n' && c != EOF) {}
            if (c == EOF) break;
            continue;
        }
        switch (calcola(a, op, b, &r)) {
        case 0: printf("= %g\\n", r); break;
        case -1: printf("Errore: divisione per zero\\n"); break;
        default: printf("Operatore sconosciuto: %c\\n", op); break;
        }
    }
    printf("Ciao!\\n");
    return 0;
}
`;

const FUNCS_H = `#ifndef FUNCTIONS_H
#define FUNCTIONS_H

/** Restituisce la somma di a e b. */
int add(int a, int b);

/** Restituisce il massimo di un array di n elementi (n > 0). */
int max_of(const int *values, int n);

/** Calcola n! (n <= 20). */
unsigned long long factorial(unsigned int n);

#endif /* FUNCTIONS_H */
`;

const FUNCS_C = `#include "functions.h"

int add(int a, int b) {
    return a + b;
}

int max_of(const int *values, int n) {
    int best = values[0];
    for (int i = 1; i < n; i++) {
        if (values[i] > best) {
            best = values[i];
        }
    }
    return best;
}

unsigned long long factorial(unsigned int n) {
    unsigned long long r = 1;
    for (unsigned int i = 2; i <= n; i++) {
        r *= i;
    }
    return r;
}
`;

const MULTI_MAIN = `#include <stdio.h>
#include "functions.h"

int main(void) {
    int numbers[] = {4, 8, 15, 16, 23, 42};
    int n = (int)(sizeof numbers / sizeof numbers[0]);

    printf("add(2, 3)   = %d\\n", add(2, 3));
    printf("max_of(...) = %d\\n", max_of(numbers, n));
    printf("10!         = %llu\\n", factorial(10));
    return 0;
}
`;

const LIST_H = `#ifndef LIST_H
#define LIST_H

#include <stdbool.h>
#include <stddef.h>

typedef struct Node {
    int value;
    struct Node *next;
} Node;

typedef struct {
    Node *head;
    size_t size;
} List;

void list_init(List *list);
bool list_push_front(List *list, int value);
bool list_remove(List *list, int value);
void list_print(const List *list);
void list_free(List *list);

#endif
`;

const LIST_C = `#include <stdio.h>
#include <stdlib.h>
#include "list.h"

void list_init(List *list) {
    list->head = NULL;
    list->size = 0;
}

bool list_push_front(List *list, int value) {
    Node *node = malloc(sizeof *node);
    if (node == NULL) {
        return false;
    }
    node->value = value;
    node->next = list->head;
    list->head = node;
    list->size++;
    return true;
}

bool list_remove(List *list, int value) {
    Node **link = &list->head;
    while (*link != NULL) {
        if ((*link)->value == value) {
            Node *dead = *link;
            *link = dead->next;
            free(dead);
            list->size--;
            return true;
        }
        link = &(*link)->next;
    }
    return false;
}

void list_print(const List *list) {
    printf("[");
    for (const Node *n = list->head; n != NULL; n = n->next) {
        printf("%d%s", n->value, n->next ? ", " : "");
    }
    printf("] (size %zu)\\n", list->size);
}

void list_free(List *list) {
    Node *n = list->head;
    while (n != NULL) {
        Node *next = n->next;
        free(n);
        n = next;
    }
    list_init(list);
}
`;

const STACK_H = `#ifndef STACK_H
#define STACK_H

#include <stdbool.h>

#define STACK_CAPACITY 128

typedef struct {
    int items[STACK_CAPACITY];
    int top;
} Stack;

void stack_init(Stack *s);
bool stack_push(Stack *s, int value);
bool stack_pop(Stack *s, int *out);
bool stack_is_empty(const Stack *s);

#endif
`;

const STACK_C = `#include "stack.h"

void stack_init(Stack *s) { s->top = 0; }

bool stack_push(Stack *s, int value) {
    if (s->top >= STACK_CAPACITY) return false;
    s->items[s->top++] = value;
    return true;
}

bool stack_pop(Stack *s, int *out) {
    if (s->top == 0) return false;
    *out = s->items[--s->top];
    return true;
}

bool stack_is_empty(const Stack *s) { return s->top == 0; }
`;

const DS_MAIN = `#include <stdio.h>
#include "list.h"
#include "stack.h"

int main(void) {
    List list;
    list_init(&list);
    for (int i = 1; i <= 5; i++) {
        list_push_front(&list, i * 10);
    }
    list_print(&list);
    list_remove(&list, 30);
    list_print(&list);
    list_free(&list);

    Stack s;
    stack_init(&s);
    for (int i = 0; i < 4; i++) stack_push(&s, i * i);
    printf("Stack pop:");
    int v;
    while (stack_pop(&s, &v)) printf(" %d", v);
    printf("\\n");
    return 0;
}
`;

const SORT_H = `#ifndef SORTING_H
#define SORTING_H

void bubble_sort(int *a, int n);
void quick_sort(int *a, int lo, int hi);
int binary_search(const int *a, int n, int key);
void print_array(const char *label, const int *a, int n);

#endif
`;

const SORT_C = `#include <stdio.h>
#include "sorting.h"

static void swap(int *x, int *y) {
    int t = *x;
    *x = *y;
    *y = t;
}

void bubble_sort(int *a, int n) {
    for (int i = 0; i < n - 1; i++) {
        int swapped = 0;
        for (int j = 0; j < n - 1 - i; j++) {
            if (a[j] > a[j + 1]) {
                swap(&a[j], &a[j + 1]);
                swapped = 1;
            }
        }
        if (!swapped) break;
    }
}

static int partition(int *a, int lo, int hi) {
    int pivot = a[hi];
    int i = lo - 1;
    for (int j = lo; j < hi; j++) {
        if (a[j] <= pivot) swap(&a[++i], &a[j]);
    }
    swap(&a[i + 1], &a[hi]);
    return i + 1;
}

void quick_sort(int *a, int lo, int hi) {
    if (lo < hi) {
        int p = partition(a, lo, hi);
        quick_sort(a, lo, p - 1);
        quick_sort(a, p + 1, hi);
    }
}

int binary_search(const int *a, int n, int key) {
    int lo = 0, hi = n - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (a[mid] == key) return mid;
        if (a[mid] < key) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

void print_array(const char *label, const int *a, int n) {
    printf("%-10s", label);
    for (int i = 0; i < n; i++) printf(" %3d", a[i]);
    printf("\\n");
}
`;

const ALGO_MAIN = `#include <stdio.h>
#include <string.h>
#include "sorting.h"

#define N 10

int main(void) {
    int data[N] = {42, 7, 19, 3, 88, 21, 5, 64, 12, 30};
    int copy[N];

    print_array("Originale", data, N);

    memcpy(copy, data, sizeof data);
    bubble_sort(copy, N);
    print_array("Bubble", copy, N);

    memcpy(copy, data, sizeof data);
    quick_sort(copy, 0, N - 1);
    print_array("Quick", copy, N);

    int key = 21;
    int pos = binary_search(copy, N, key);
    printf("Ricerca binaria di %d: indice %d\\n", key, pos);
    return 0;
}
`;

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'empty',
    name: 'Empty C Project',
    description: 'Struttura vuota con cartelle src/ e include/.',
    files: { 'README.md': readme('Nuovo progetto', 'Progetto C vuoto.') },
    folders: ['src', 'include', 'build'],
    open: [],
  },
  {
    id: 'console',
    name: 'Console Application',
    description: 'Programma interattivo che legge input da tastiera.',
    files: { 'src/main.c': CONSOLE, 'README.md': readme('Console Application', 'Legge una riga da stdin e saluta l’utente.') },
    folders: ['src', 'include', 'build'],
    open: ['src/main.c'],
  },
  {
    id: 'hello',
    name: 'Hello World',
    description: 'Il classico primo programma.',
    files: { 'src/main.c': HELLO, 'README.md': readme('Hello World', 'Stampa "Hello, World!".') },
    folders: ['src', 'include', 'build'],
    open: ['src/main.c'],
  },
  {
    id: 'calculator',
    name: 'Calculator',
    description: 'Calcolatrice interattiva con gestione degli errori.',
    files: { 'src/main.c': CALC, 'README.md': readme('Calculator', 'Calcolatrice a riga di comando: `3 * 4`, `q` per uscire.') },
    folders: ['src', 'include', 'build'],
    open: ['src/main.c'],
  },
  {
    id: 'multifile',
    name: 'Multi-file Project',
    description: 'main.c, functions.c e functions.h con header guard.',
    files: {
      'src/main.c': MULTI_MAIN,
      'src/functions.c': FUNCS_C,
      'include/functions.h': FUNCS_H,
      'README.md': readme('Multi-file Project', 'Esempio di progetto suddiviso in più unità di compilazione.'),
    },
    folders: ['src', 'include', 'build'],
    open: ['src/main.c', 'src/functions.c', 'include/functions.h'],
  },
  {
    id: 'datastructures',
    name: 'Data Structures',
    description: 'Lista concatenata e stack con allocazione dinamica.',
    files: {
      'src/main.c': DS_MAIN,
      'src/list.c': LIST_C,
      'src/stack.c': STACK_C,
      'include/list.h': LIST_H,
      'include/stack.h': STACK_H,
      'README.md': readme('Data Structures', 'Implementazioni di lista concatenata e stack.'),
    },
    folders: ['src', 'include', 'build'],
    open: ['src/main.c', 'src/list.c'],
  },
  {
    id: 'algorithms',
    name: 'Algorithms',
    description: 'Bubble sort, quick sort e ricerca binaria.',
    files: {
      'src/main.c': ALGO_MAIN,
      'src/sorting.c': SORT_C,
      'include/sorting.h': SORT_H,
      'README.md': readme('Algorithms', 'Algoritmi di ordinamento e ricerca.'),
    },
    folders: ['src', 'include', 'build'],
    open: ['src/main.c', 'src/sorting.c'],
  },
  {
    id: 'custom',
    name: 'Custom Project',
    description: 'Scegli tu cartelle e file iniziali.',
    files: {},
    folders: [],
    open: [],
  },
];

export interface CustomTemplateOptions {
  srcDir: boolean;
  includeDir: boolean;
  mainFile: boolean;
  readme: boolean;
}

export function buildCustomTemplate(o: CustomTemplateOptions, name: string): TemplateDef {
  const files: Record<string, string> = {};
  const folders: string[] = ['build'];
  if (o.srcDir) folders.push('src');
  if (o.includeDir) folders.push('include');
  const mainPath = o.srcDir ? 'src/main.c' : 'main.c';
  if (o.mainFile) files[mainPath] = HELLO;
  if (o.readme) files['README.md'] = readme(name, 'Progetto personalizzato.');
  return { id: 'custom', name: 'Custom Project', description: '', files, folders, open: o.mainFile ? [mainPath] : [] };
}

/* ───────────── Examples shown on the welcome screen ───────────── */
export const EXAMPLES: { id: string; name: string; description: string; code: string; libraries?: string[] }[] = [
  {
    id: 'pointers',
    name: 'Puntatori',
    description: 'Indirizzi, dereferenziazione e passaggio per riferimento.',
    code: `#include <stdio.h>

static void swap(int *a, int *b) {
    int tmp = *a;
    *a = *b;
    *b = tmp;
}

int main(void) {
    int x = 3, y = 7;
    int *p = &x;

    printf("x = %d, indirizzo di x = %p\\n", x, (void *)p);
    *p = 10;
    printf("dopo *p = 10 -> x = %d\\n", x);

    swap(&x, &y);
    printf("dopo swap -> x = %d, y = %d\\n", x, y);
    return 0;
}
`,
  },
  {
    id: 'structs',
    name: 'Struct e typedef',
    description: 'Definire e usare tipi composti.',
    code: `#include <stdio.h>
#include <string.h>

typedef struct {
    char name[32];
    int age;
    double grade;
} Student;

static void print_student(const Student *s) {
    printf("%-10s %3d anni  media %.1f\\n", s->name, s->age, s->grade);
}

int main(void) {
    Student class_[] = {
        {"Anna", 20, 28.5},
        {"Marco", 22, 26.0},
        {"Giulia", 21, 29.3},
    };
    size_t n = sizeof class_ / sizeof class_[0];
    for (size_t i = 0; i < n; i++) {
        print_student(&class_[i]);
    }
    return 0;
}
`,
  },
  {
    id: 'recursion',
    name: 'Ricorsione',
    description: 'Fibonacci e torre di Hanoi.',
    code: `#include <stdio.h>

static unsigned long fib(unsigned n) {
    return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

static void hanoi(int n, char from, char to, char via) {
    if (n == 0) return;
    hanoi(n - 1, from, via, to);
    printf("Sposta disco %d da %c a %c\\n", n, from, to);
    hanoi(n - 1, via, to, from);
}

int main(void) {
    for (unsigned i = 0; i <= 15; i++) {
        printf("fib(%u) = %lu\\n", i, fib(i));
    }
    hanoi(3, 'A', 'C', 'B');
    return 0;
}
`,
  },
  {
    id: 'math',
    name: 'Libreria math.h',
    description: 'Funzioni matematiche (richiede -lm).',
    libraries: ['m'],
    code: `#include <stdio.h>
#include <math.h>

int main(void) {
    for (double x = 0.0; x <= 1.0001; x += 0.25) {
        printf("x=%.2f  sin=%.4f  cos=%.4f  sqrt=%.4f\\n", x, sin(x), cos(x), sqrt(x));
    }
    printf("pi ~ %.10f\\n", 4.0 * atan(1.0));
    return 0;
}
`,
  },
  {
    id: 'memory',
    name: 'Memoria dinamica',
    description: 'malloc, realloc e free con controllo errori.',
    code: `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    size_t cap = 2, len = 0;
    int *v = malloc(cap * sizeof *v);
    if (!v) return 1;

    for (int i = 1; i <= 10; i++) {
        if (len == cap) {
            cap *= 2;
            int *tmp = realloc(v, cap * sizeof *v);
            if (!tmp) { free(v); return 1; }
            v = tmp;
            printf("capacita' -> %zu\\n", cap);
        }
        v[len++] = i * i;
    }
    for (size_t i = 0; i < len; i++) printf("%d ", v[i]);
    printf("\\n");
    free(v);
    return 0;
}
`,
  },
];
