/** Reusable UI primitives. */
import { ReactNode, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { X, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import { useFeedback, dismissToast } from '../../stores/uiFeedback';
import { fileKind } from '../../utils/path';

export function Logo({ size = 26, className = 'brand-logo' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="cs-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#cs-g)" />
      <path d="M40.5 21.5a14 14 0 1 0 0 21" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <circle cx="46" cy="32" r="3.6" fill="#fff" />
    </svg>
  );
}

export function FileIcon({ path }: { path: string }) {
  const k = fileKind(path);
  const label = { c: 'C', h: 'H', md: 'M↓', json: '{}', txt: 'TXT', make: 'MK', other: '•' }[k];
  return <span className={`file-icon ${k}`}>{label}</span>;
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h4>{title}</h4>
      {children}
    </div>
  );
}

export function Dialog({ title, onClose, children, footer, size, icon }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'full'; icon?: ReactNode }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${size ?? ''}`} role="dialog" aria-modal="true">
        <div className="dialog-head">
          {icon}
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi" title="Chiudi (Esc)">
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmHost() {
  const req = useFeedback((s) => s.confirmReq);
  if (!req) return null;
  return (
    <div className="overlay" style={{ zIndex: 140 }}>
      <div className="dialog" role="alertdialog" aria-modal="true" style={{ width: 'min(460px, 100%)' }}>
        <div className="dialog-head">
          <h2>{req.title}</h2>
        </div>
        <div className="dialog-body">
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{req.message}</p>
        </div>
        <div className="dialog-foot">
          {req.buttons.map((b, i) => (
            <button key={b.id} className={`btn ${b.variant ?? ''}`} autoFocus={i === req.buttons.length - 1} onClick={() => req.resolve(b.id)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PromptHost() {
  const req = useFeedback((s) => s.promptReq);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!req) return;
    setValue(req.initial);
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      if (req.selectStem) {
        const dot = req.initial.lastIndexOf('.');
        el.setSelectionRange(0, dot > 0 ? dot : req.initial.length);
      } else el.select();
    }, 30);
  }, [req]);
  if (!req) return null;
  const error = req.validate ? req.validate(value) : null;
  const submit = () => {
    if (!error) req.resolve(value.trim());
  };
  return (
    <div className="overlay" style={{ zIndex: 140 }} onMouseDown={(e) => e.target === e.currentTarget && req.resolve(null)}>
      <form className="dialog" style={{ width: 'min(480px, 100%)' }} onSubmit={(e) => (e.preventDefault(), submit())}>
        <div className="dialog-head">
          <h2>{req.title}</h2>
        </div>
        <div className="dialog-body">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="prompt-input">{req.label}</label>
            <input
              id="prompt-input"
              ref={inputRef}
              className={`input ${value && error ? 'invalid' : ''}`}
              value={value}
              placeholder={req.placeholder}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && req.resolve(null)}
            />
            {value && error && <span className="error-text">{error}</span>}
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={() => req.resolve(null)}>
            Annulla
          </button>
          <button type="submit" className="btn primary" disabled={!!error}>
            {req.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Toasts() {
  const toasts = useFeedback((s) => s.toasts);
  const icons = { info: <Info size={18} color="var(--info)" />, success: <CheckCircle2 size={18} color="var(--success)" />, warning: <AlertTriangle size={18} color="var(--warning)" />, error: <XCircle size={18} color="var(--error)" /> };
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {icons[t.kind]}
          <div className="grow">
            <div>{t.message}</div>
            {t.detail && <div className="muted" style={{ fontSize: '0.9em', marginTop: 2 }}>{t.detail}</div>}
            {t.action && (
              <button className="btn sm" style={{ marginTop: 6 }} onClick={() => (t.action!.run(), dismissToast(t.id))}>
                {t.action.label}
              </button>
            )}
          </div>
          <button className="icon-btn sm" onClick={() => dismissToast(t.id)} aria-label="Chiudi notifica">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ───────────── Context menu (global) ───────────── */
export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  run?: () => void;
}

interface MenuState {
  menu: { x: number; y: number; items: MenuItem[] } | null;
}
export const useMenu = create<MenuState>(() => ({ menu: null }));
export function openMenu(x: number, y: number, items: MenuItem[]) {
  useMenu.setState({ menu: { x, y, items } });
}
export function closeMenu() {
  useMenu.setState({ menu: null });
}

export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!menu) return;
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 300;
    setPos({ x: Math.max(4, Math.min(menu.x, window.innerWidth - w - 4)), y: Math.max(4, Math.min(menu.y, window.innerHeight - h - 4)) });
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      closeMenu();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu();
    setTimeout(() => {
      window.addEventListener('pointerdown', close, true);
      window.addEventListener('keydown', esc);
      window.addEventListener('resize', closeMenu);
    }, 0);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('resize', closeMenu);
    };
  }, [menu]);
  if (!menu) return null;
  return (
    <div className="ctx" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) =>
        it.separator ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? 'danger' : ''}
            disabled={it.disabled}
            onClick={() => {
              closeMenu();
              it.run?.();
            }}
          >
            {it.icon}
            <span>{it.label}</span>
            {it.keys && <span className="k">{it.keys}</span>}
          </button>
        ),
      )}
    </div>
  );
}
