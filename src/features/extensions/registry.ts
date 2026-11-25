/**
 * Extension architecture. Built-in features are registered as extensions so they can be
 * toggled from the Extensions view; third-party extensions can implement the same interface
 * (`activate` receives an API object) — loading external code is intentionally not enabled yet.
 */
import type { LucideIcon } from 'lucide-react';
import { Sparkles, Wand2, Keyboard, BookOpen, Braces, Bug, Lightbulb } from 'lucide-react';

export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  builtin: boolean;
  /** shown when the extension cannot be enabled */
  unavailableReason?: string;
  requiresBackend?: boolean;
}

export const EXTENSIONS: ExtensionManifest[] = [
  { id: 'intellisense', name: 'C IntelliSense', description: 'Completamento di funzioni standard, simboli del progetto, variabili locali, tipi e header; signature help; vai alla definizione; trova riferimenti.', icon: Lightbulb, builtin: true },
  { id: 'snippets', name: 'Snippet C', description: 'Libreria di snippet (for, struct, malloc, header guard…) e snippet personalizzati.', icon: Braces, builtin: true },
  { id: 'docsHover', name: 'Documentazione al passaggio', description: 'Tooltip con firma e descrizione delle funzioni della libreria standard e del progetto.', icon: BookOpen, builtin: true },
  { id: 'formatter', name: 'Formatter (clang-format)', description: 'Formattazione del documento tramite clang-format sul server.', icon: Wand2, builtin: true, requiresBackend: true },
  { id: 'liveDiagnostics', name: 'Diagnostica al salvataggio', description: 'Compila in background a ogni salvataggio e mostra errori e warning nell’editor.', icon: Bug, builtin: true, requiresBackend: true },
  { id: 'tabletKeys', name: 'Tastiera rapida per tablet', description: 'Barra con simboli e scorciatoie del C sopra la tastiera virtuale.', icon: Keyboard, builtin: true },
  { id: 'ai', name: 'AI Assistant', description: 'Spiegazione del codice, ricerca errori, suggerimenti, generazione e documentazione.', icon: Sparkles, builtin: true, unavailableReason: 'Nessun provider AI configurato. L’architettura è pronta (src/features/ai/assistant.ts) ma la funzione non è ancora implementata.' },
];

export interface ExtensionApi {
  registerCommand(id: string, label: string, run: () => void): void;
}
