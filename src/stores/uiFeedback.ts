/** Toasts, confirmation and prompt dialogs exposed as promise-based helpers. */
import { create } from 'zustand';
import { uid } from '../utils/misc';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
  action?: { label: string; run: () => void };
  duration: number;
}

export interface ConfirmButton {
  id: string;
  label: string;
  variant?: 'primary' | 'danger' | 'default';
}

export interface ConfirmRequest {
  id: string;
  title: string;
  message: string;
  buttons: ConfirmButton[];
  resolve: (choice: string) => void;
}

export interface PromptRequest {
  id: string;
  title: string;
  label: string;
  initial: string;
  placeholder?: string;
  confirmLabel: string;
  selectStem?: boolean;
  validate?: (v: string) => string | null;
  resolve: (value: string | null) => void;
}

interface FeedbackState {
  toasts: Toast[];
  confirmReq: ConfirmRequest | null;
  promptReq: PromptRequest | null;
}

export const useFeedback = create<FeedbackState>(() => ({ toasts: [], confirmReq: null, promptReq: null }));

export function toast(kind: ToastKind, message: string, opts: { detail?: string; action?: Toast['action']; duration?: number } = {}): void {
  const t: Toast = { id: uid('t'), kind, message, detail: opts.detail, action: opts.action, duration: opts.duration ?? (kind === 'error' ? 7000 : 3500) };
  useFeedback.setState((s) => ({ toasts: [...s.toasts.slice(-4), t] }));
  if (t.duration > 0) setTimeout(() => dismissToast(t.id), t.duration);
}

export function dismissToast(id: string): void {
  useFeedback.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function confirmDialog(opts: { title: string; message: string; buttons?: ConfirmButton[]; confirmLabel?: string; danger?: boolean }): Promise<string> {
  const buttons = opts.buttons ?? [
    { id: 'cancel', label: 'Annulla' },
    { id: 'ok', label: opts.confirmLabel ?? 'Conferma', variant: opts.danger ? 'danger' : 'primary' },
  ];
  return new Promise((resolve) => {
    useFeedback.setState({
      confirmReq: {
        id: uid('c'), title: opts.title, message: opts.message, buttons,
        resolve: (choice) => {
          useFeedback.setState({ confirmReq: null });
          resolve(choice);
        },
      },
    });
  });
}

export async function confirmYes(opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return (await confirmDialog(opts)) === 'ok';
}

export function promptDialog(opts: Omit<PromptRequest, 'id' | 'resolve' | 'confirmLabel' | 'initial'> & { initial?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    useFeedback.setState({
      promptReq: {
        ...opts,
        id: uid('p'),
        initial: opts.initial ?? '',
        confirmLabel: opts.confirmLabel ?? 'OK',
        resolve: (v) => {
          useFeedback.setState({ promptReq: null });
          resolve(v);
        },
      },
    });
  });
}
