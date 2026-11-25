/** Reference data for the C standard library: IntelliSense, hovers, signature help and the docs screen. */

export interface StdFunction {
  name: string;
  header: string;
  signature: string;
  doc: string;
  params: string[];
  returns: string;
}

type Row = [name: string, header: string, signature: string, doc: string, returns?: string];

const ROWS: Row[] = [
  // stdio.h
  ['printf', 'stdio.h', 'int printf(const char *format, ...)', 'Scrive output formattato su stdout.', 'Numero di caratteri scritti, negativo in caso di errore.'],
  ['fprintf', 'stdio.h', 'int fprintf(FILE *stream, const char *format, ...)', 'Scrive output formattato su uno stream.', 'Numero di caratteri scritti.'],
  ['sprintf', 'stdio.h', 'int sprintf(char *str, const char *format, ...)', 'Scrive output formattato in una stringa (attenzione all’overflow: preferire snprintf).'],
  ['snprintf', 'stdio.h', 'int snprintf(char *str, size_t size, const char *format, ...)', 'Scrive al massimo size-1 caratteri formattati in str, sempre terminata da \\0.', 'Lunghezza che avrebbe avuto l’output completo.'],
  ['scanf', 'stdio.h', 'int scanf(const char *format, ...)', 'Legge input formattato da stdin. Gli argomenti devono essere puntatori.', 'Numero di elementi assegnati, EOF a fine input.'],
  ['fscanf', 'stdio.h', 'int fscanf(FILE *stream, const char *format, ...)', 'Legge input formattato da uno stream.'],
  ['sscanf', 'stdio.h', 'int sscanf(const char *str, const char *format, ...)', 'Legge input formattato da una stringa.'],
  ['puts', 'stdio.h', 'int puts(const char *s)', 'Scrive la stringa s e un newline su stdout.'],
  ['putchar', 'stdio.h', 'int putchar(int c)', 'Scrive un carattere su stdout.'],
  ['getchar', 'stdio.h', 'int getchar(void)', 'Legge un carattere da stdin.', 'Il carattere letto come unsigned char convertito a int, oppure EOF.'],
  ['fgets', 'stdio.h', 'char *fgets(char *s, int size, FILE *stream)', 'Legge una riga (al massimo size-1 caratteri, newline incluso) da stream.', 's, oppure NULL a fine file o errore.'],
  ['fputs', 'stdio.h', 'int fputs(const char *s, FILE *stream)', 'Scrive una stringa su uno stream (senza newline).'],
  ['fgetc', 'stdio.h', 'int fgetc(FILE *stream)', 'Legge un carattere da uno stream.'],
  ['fputc', 'stdio.h', 'int fputc(int c, FILE *stream)', 'Scrive un carattere su uno stream.'],
  ['fopen', 'stdio.h', 'FILE *fopen(const char *path, const char *mode)', 'Apre un file. Modalità: "r", "w", "a", "r+", "w+", "a+", con "b" opzionale.', 'Puntatore FILE oppure NULL (vedi errno).'],
  ['fclose', 'stdio.h', 'int fclose(FILE *stream)', 'Chiude uno stream e libera le risorse associate.'],
  ['fread', 'stdio.h', 'size_t fread(void *ptr, size_t size, size_t nmemb, FILE *stream)', 'Legge nmemb elementi di size byte.', 'Numero di elementi letti.'],
  ['fwrite', 'stdio.h', 'size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream)', 'Scrive nmemb elementi di size byte.', 'Numero di elementi scritti.'],
  ['fseek', 'stdio.h', 'int fseek(FILE *stream, long offset, int whence)', 'Sposta la posizione nel file (SEEK_SET, SEEK_CUR, SEEK_END).'],
  ['ftell', 'stdio.h', 'long ftell(FILE *stream)', 'Restituisce la posizione corrente nel file.'],
  ['rewind', 'stdio.h', 'void rewind(FILE *stream)', 'Riporta la posizione all’inizio del file.'],
  ['feof', 'stdio.h', 'int feof(FILE *stream)', 'Verifica l’indicatore di fine file.'],
  ['ferror', 'stdio.h', 'int ferror(FILE *stream)', 'Verifica l’indicatore di errore dello stream.'],
  ['fflush', 'stdio.h', 'int fflush(FILE *stream)', 'Svuota il buffer di output dello stream.'],
  ['perror', 'stdio.h', 'void perror(const char *s)', 'Stampa su stderr s seguito dalla descrizione di errno.'],
  ['remove', 'stdio.h', 'int remove(const char *path)', 'Elimina un file.'],
  ['rename', 'stdio.h', 'int rename(const char *old, const char *new)', 'Rinomina un file.'],
  ['setvbuf', 'stdio.h', 'int setvbuf(FILE *stream, char *buf, int mode, size_t size)', 'Imposta la bufferizzazione (_IOFBF, _IOLBF, _IONBF).'],
  ['getline', 'stdio.h', 'ssize_t getline(char **lineptr, size_t *n, FILE *stream)', 'POSIX: legge una riga allocando il buffer dinamicamente.'],
  // stdlib.h
  ['malloc', 'stdlib.h', 'void *malloc(size_t size)', 'Alloca size byte non inizializzati.', 'Puntatore alla memoria o NULL.'],
  ['calloc', 'stdlib.h', 'void *calloc(size_t nmemb, size_t size)', 'Alloca un array di nmemb elementi inizializzati a zero.'],
  ['realloc', 'stdlib.h', 'void *realloc(void *ptr, size_t size)', 'Ridimensiona un blocco allocato. Se fallisce, il blocco originale resta valido.'],
  ['free', 'stdlib.h', 'void free(void *ptr)', 'Libera memoria allocata con malloc/calloc/realloc. free(NULL) non fa nulla.'],
  ['exit', 'stdlib.h', 'void exit(int status)', 'Termina il programma (EXIT_SUCCESS / EXIT_FAILURE).'],
  ['abort', 'stdlib.h', 'void abort(void)', 'Termina in modo anomalo il programma (SIGABRT).'],
  ['atexit', 'stdlib.h', 'int atexit(void (*func)(void))', 'Registra una funzione da chiamare all’uscita.'],
  ['atoi', 'stdlib.h', 'int atoi(const char *s)', 'Converte una stringa in int (senza rilevazione errori: preferire strtol).'],
  ['atof', 'stdlib.h', 'double atof(const char *s)', 'Converte una stringa in double.'],
  ['strtol', 'stdlib.h', 'long strtol(const char *s, char **endptr, int base)', 'Converte una stringa in long con rilevazione errori.'],
  ['strtoul', 'stdlib.h', 'unsigned long strtoul(const char *s, char **endptr, int base)', 'Converte una stringa in unsigned long.'],
  ['strtod', 'stdlib.h', 'double strtod(const char *s, char **endptr)', 'Converte una stringa in double.'],
  ['rand', 'stdlib.h', 'int rand(void)', 'Numero pseudo-casuale tra 0 e RAND_MAX.'],
  ['srand', 'stdlib.h', 'void srand(unsigned int seed)', 'Inizializza il generatore di rand().'],
  ['qsort', 'stdlib.h', 'void qsort(void *base, size_t nmemb, size_t size, int (*compar)(const void *, const void *))', 'Ordina un array con una funzione di confronto.'],
  ['bsearch', 'stdlib.h', 'void *bsearch(const void *key, const void *base, size_t nmemb, size_t size, int (*compar)(const void *, const void *))', 'Ricerca binaria in un array ordinato.'],
  ['abs', 'stdlib.h', 'int abs(int j)', 'Valore assoluto di un int.'],
  ['labs', 'stdlib.h', 'long labs(long j)', 'Valore assoluto di un long.'],
  ['getenv', 'stdlib.h', 'char *getenv(const char *name)', 'Valore di una variabile d’ambiente o NULL.'],
  ['system', 'stdlib.h', 'int system(const char *command)', 'Esegue un comando della shell (nella sandbox l’accesso è limitato).'],
  // string.h
  ['strlen', 'string.h', 'size_t strlen(const char *s)', 'Lunghezza della stringa, terminatore escluso.'],
  ['strcpy', 'string.h', 'char *strcpy(char *dest, const char *src)', 'Copia src in dest (dest deve essere abbastanza grande).'],
  ['strncpy', 'string.h', 'char *strncpy(char *dest, const char *src, size_t n)', 'Copia al massimo n caratteri (non garantisce il terminatore).'],
  ['strcat', 'string.h', 'char *strcat(char *dest, const char *src)', 'Concatena src a dest.'],
  ['strncat', 'string.h', 'char *strncat(char *dest, const char *src, size_t n)', 'Concatena al massimo n caratteri.'],
  ['strcmp', 'string.h', 'int strcmp(const char *a, const char *b)', 'Confronta due stringhe.', '<0, 0 o >0.'],
  ['strncmp', 'string.h', 'int strncmp(const char *a, const char *b, size_t n)', 'Confronta al massimo n caratteri.'],
  ['strchr', 'string.h', 'char *strchr(const char *s, int c)', 'Prima occorrenza del carattere c.'],
  ['strrchr', 'string.h', 'char *strrchr(const char *s, int c)', 'Ultima occorrenza del carattere c.'],
  ['strstr', 'string.h', 'char *strstr(const char *haystack, const char *needle)', 'Prima occorrenza di una sottostringa.'],
  ['strtok', 'string.h', 'char *strtok(char *str, const char *delim)', 'Suddivide una stringa in token (modifica str).'],
  ['strdup', 'string.h', 'char *strdup(const char *s)', 'Duplica una stringa allocando memoria (C23 / POSIX).'],
  ['strcspn', 'string.h', 'size_t strcspn(const char *s, const char *reject)', 'Lunghezza del prefisso senza caratteri di reject.'],
  ['strspn', 'string.h', 'size_t strspn(const char *s, const char *accept)', 'Lunghezza del prefisso composto solo da caratteri di accept.'],
  ['strerror', 'string.h', 'char *strerror(int errnum)', 'Descrizione testuale di un codice di errore.'],
  ['memcpy', 'string.h', 'void *memcpy(void *dest, const void *src, size_t n)', 'Copia n byte (le aree non devono sovrapporsi).'],
  ['memmove', 'string.h', 'void *memmove(void *dest, const void *src, size_t n)', 'Copia n byte gestendo aree sovrapposte.'],
  ['memset', 'string.h', 'void *memset(void *s, int c, size_t n)', 'Riempie n byte con il valore c.'],
  ['memcmp', 'string.h', 'int memcmp(const void *a, const void *b, size_t n)', 'Confronta n byte.'],
  // ctype.h
  ['isalpha', 'ctype.h', 'int isalpha(int c)', 'Vero se c è una lettera.'],
  ['isdigit', 'ctype.h', 'int isdigit(int c)', 'Vero se c è una cifra decimale.'],
  ['isalnum', 'ctype.h', 'int isalnum(int c)', 'Vero se c è lettera o cifra.'],
  ['isspace', 'ctype.h', 'int isspace(int c)', 'Vero se c è uno spazio bianco.'],
  ['isupper', 'ctype.h', 'int isupper(int c)', 'Vero se c è maiuscola.'],
  ['islower', 'ctype.h', 'int islower(int c)', 'Vero se c è minuscola.'],
  ['ispunct', 'ctype.h', 'int ispunct(int c)', 'Vero se c è un carattere di punteggiatura.'],
  ['toupper', 'ctype.h', 'int toupper(int c)', 'Converte in maiuscolo.'],
  ['tolower', 'ctype.h', 'int tolower(int c)', 'Converte in minuscolo.'],
  // math.h
  ['sqrt', 'math.h', 'double sqrt(double x)', 'Radice quadrata (link con -lm).'],
  ['pow', 'math.h', 'double pow(double x, double y)', 'x elevato a y.'],
  ['fabs', 'math.h', 'double fabs(double x)', 'Valore assoluto di un double.'],
  ['floor', 'math.h', 'double floor(double x)', 'Arrotonda per difetto.'],
  ['ceil', 'math.h', 'double ceil(double x)', 'Arrotonda per eccesso.'],
  ['round', 'math.h', 'double round(double x)', 'Arrotonda all’intero più vicino.'],
  ['fmod', 'math.h', 'double fmod(double x, double y)', 'Resto della divisione in virgola mobile.'],
  ['sin', 'math.h', 'double sin(double x)', 'Seno (radianti).'],
  ['cos', 'math.h', 'double cos(double x)', 'Coseno (radianti).'],
  ['tan', 'math.h', 'double tan(double x)', 'Tangente (radianti).'],
  ['atan', 'math.h', 'double atan(double x)', 'Arcotangente.'],
  ['atan2', 'math.h', 'double atan2(double y, double x)', 'Arcotangente di y/x nel quadrante corretto.'],
  ['exp', 'math.h', 'double exp(double x)', 'e elevato a x.'],
  ['log', 'math.h', 'double log(double x)', 'Logaritmo naturale.'],
  ['log10', 'math.h', 'double log10(double x)', 'Logaritmo in base 10.'],
  ['hypot', 'math.h', 'double hypot(double x, double y)', 'sqrt(x*x + y*y) senza overflow intermedio.'],
  // time.h
  ['time', 'time.h', 'time_t time(time_t *t)', 'Tempo corrente in secondi dall’epoca.'],
  ['clock', 'time.h', 'clock_t clock(void)', 'Tempo di CPU usato (dividere per CLOCKS_PER_SEC).'],
  ['difftime', 'time.h', 'double difftime(time_t end, time_t start)', 'Differenza in secondi.'],
  ['localtime', 'time.h', 'struct tm *localtime(const time_t *t)', 'Converte in ora locale.'],
  ['strftime', 'time.h', 'size_t strftime(char *s, size_t max, const char *format, const struct tm *tm)', 'Formatta data e ora.'],
  // assert.h / errno / signal / unistd
  ['assert', 'assert.h', 'void assert(scalar expression)', 'Interrompe il programma se l’espressione è falsa (disattivato con NDEBUG).'],
  ['signal', 'signal.h', 'void (*signal(int sig, void (*handler)(int)))(int)', 'Installa un gestore di segnale.'],
  ['raise', 'signal.h', 'int raise(int sig)', 'Invia un segnale al programma corrente.'],
  ['sleep', 'unistd.h', 'unsigned int sleep(unsigned int seconds)', 'POSIX: sospende per alcuni secondi.'],
  ['usleep', 'unistd.h', 'int usleep(useconds_t usec)', 'POSIX: sospende per alcuni microsecondi.'],
  // stdbool / stdint helpers as pseudo functions are covered by types/macros
];

function splitParams(sig: string): string[] {
  const inner = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
  if (!inner.trim() || inner.trim() === 'void') return [];
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export const STD_FUNCTIONS: StdFunction[] = ROWS.map(([name, header, signature, doc, returns]) => ({
  name, header, signature, doc, returns: returns ?? '', params: splitParams(signature),
}));
export const STD_BY_NAME = new Map(STD_FUNCTIONS.map((f) => [f.name, f]));

export const STD_HEADERS: Record<string, string> = {
  'stdio.h': 'Input/output: printf, scanf, file (FILE*), stream standard.',
  'stdlib.h': 'Memoria dinamica, conversioni, numeri casuali, ordinamento, exit.',
  'string.h': 'Stringhe e blocchi di memoria: strlen, strcpy, memcpy…',
  'ctype.h': 'Classificazione e conversione di caratteri.',
  'math.h': 'Funzioni matematiche (richiede la libreria m: -lm).',
  'time.h': 'Data, ora e misura del tempo.',
  'stdbool.h': 'Tipo bool e costanti true/false (C99).',
  'stdint.h': 'Interi a dimensione fissa: int32_t, uint8_t, …',
  'stddef.h': 'size_t, ptrdiff_t, NULL, offsetof.',
  'limits.h': 'Limiti dei tipi interi: INT_MAX, CHAR_BIT…',
  'float.h': 'Limiti dei tipi in virgola mobile.',
  'assert.h': 'Macro assert per controlli in debug.',
  'errno.h': 'Variabile errno e codici di errore.',
  'signal.h': 'Gestione dei segnali.',
  'stdarg.h': 'Funzioni con numero variabile di argomenti (va_list).',
  'unistd.h': 'API POSIX: sleep, read, write…',
  'inttypes.h': 'Macro di formato per interi a dimensione fissa (PRId64…).',
  'threads.h': 'Thread C11 (link con pthread).',
};

export const C_KEYWORDS = [
  'auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else', 'enum', 'extern', 'for', 'goto', 'if', 'inline',
  'register', 'restrict', 'return', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'volatile', 'while',
  '_Alignas', '_Alignof', '_Atomic', '_Generic', '_Noreturn', '_Static_assert', '_Thread_local', 'alignas', 'alignof',
  'constexpr', 'nullptr', 'static_assert', 'thread_local', 'typeof',
];

export const C_TYPES = [
  'void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', '_Bool', 'bool', '_Complex',
  'size_t', 'ssize_t', 'ptrdiff_t', 'FILE', 'time_t', 'clock_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'intptr_t', 'uintptr_t', 'va_list',
];

export const C_MACROS: [string, string][] = [
  ['NULL', 'Puntatore nullo (stddef.h, stdio.h, stdlib.h…)'],
  ['EOF', 'Fine file, valore negativo (stdio.h)'],
  ['EXIT_SUCCESS', 'Codice di uscita di successo (stdlib.h)'],
  ['EXIT_FAILURE', 'Codice di uscita di errore (stdlib.h)'],
  ['RAND_MAX', 'Valore massimo di rand() (stdlib.h)'],
  ['INT_MAX', 'Valore massimo di int (limits.h)'],
  ['INT_MIN', 'Valore minimo di int (limits.h)'],
  ['CHAR_BIT', 'Bit in un char (limits.h)'],
  ['SEEK_SET', 'fseek: dall’inizio'],
  ['SEEK_CUR', 'fseek: dalla posizione corrente'],
  ['SEEK_END', 'fseek: dalla fine'],
  ['CLOCKS_PER_SEC', 'Tick di clock() per secondo (time.h)'],
  ['true', 'stdbool.h'],
  ['false', 'stdbool.h'],
  ['stdin', 'Stream di input standard'],
  ['stdout', 'Stream di output standard'],
  ['stderr', 'Stream di errore standard'],
  ['errno', 'Ultimo codice di errore (errno.h)'],
  ['M_PI', 'π (math.h, estensione POSIX)'],
];
