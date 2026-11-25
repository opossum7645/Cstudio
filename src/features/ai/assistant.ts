/**
 * AI assistant — architecture only (NOT implemented).
 *
 * A provider implements `AIProvider` and is registered with `registerAIProvider`. The IDE never
 * blocks on the assistant: every call is async, optional and cancellable. Until a provider is
 * registered, `aiAvailable()` is false and the UI shows the feature as unavailable.
 */
export interface AIContext {
  file: string;
  code: string;
  selection?: string;
  diagnostics?: { line: number; message: string }[];
  signal?: AbortSignal;
}

export interface AIProvider {
  id: string;
  name: string;
  explain(ctx: AIContext): Promise<string>;
  findBugs(ctx: AIContext): Promise<string>;
  suggestImprovements(ctx: AIContext): Promise<string>;
  generateFunction(ctx: AIContext & { prompt: string }): Promise<string>;
  document(ctx: AIContext): Promise<string>;
  optimize(ctx: AIContext): Promise<string>;
}

let provider: AIProvider | null = null;

export function registerAIProvider(p: AIProvider): void {
  provider = p;
}

export function aiAvailable(): boolean {
  return provider !== null;
}

export function getAIProvider(): AIProvider | null {
  return provider;
}
