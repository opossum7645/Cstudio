import { ChevronDown } from 'lucide-react';
import { getActiveEditor } from '../../editor/editorRegistry';
import { useApp, updateSettings } from '../../stores/appStore';
import { runCommand } from '../../features/commands/commands';
import { toast } from '../../stores/uiFeedback';

const SPECIAL: Record<string, { label: string; run: () => void | Promise<void> }> = {
  TAB: { label: 'Tab', run: () => trig('tab') },
  'S-TAB': { label: '⇤ Tab', run: () => trig('outdent') },
  '←': { label: '←', run: () => trig('cursorLeft') },
  '→': { label: '→', run: () => trig('cursorRight') },
  '↑': { label: '↑', run: () => trig('cursorUp') },
  '↓': { label: '↓', run: () => trig('cursorDown') },
  HOME: { label: 'Home', run: () => trig('cursorHome') },
  END: { label: 'End', run: () => trig('cursorEnd') },
  UNDO: { label: 'Undo', run: () => trig('undo') },
  REDO: { label: 'Redo', run: () => trig('redo') },
  FIND: { label: 'Trova', run: () => trig('actions.find') },
  SAVE: { label: 'Salva', run: () => runCommand('file.save') },
  COMMENT: { label: '//', run: () => trig('editor.action.commentLine') },
  FORMAT: { label: 'Formatta', run: () => runCommand('edit.format') },
  SELALL: { label: 'Sel. tutto', run: () => { const ed = getActiveEditor(); const m = ed?.getModel(); if (ed && m) ed.setSelection(m.getFullModelRange()); } },
  COPY: { label: 'Copia', run: () => copy(false) },
  CUT: { label: 'Taglia', run: () => copy(true) },
  PASTE: {
    label: 'Incolla',
    run: async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) insert(text);
      } catch {
        toast('warning', 'Il browser non consente di leggere gli appunti: usa il menu Incolla del sistema');
      }
    },
  },
};

function trig(id: string) {
  const ed = getActiveEditor();
  if (!ed) return;
  ed.trigger('keybar', id, null);
}

function insert(text: string) {
  const ed = getActiveEditor();
  if (!ed) return;
  ed.trigger('keybar', 'type', { text });
}

async function copy(cut: boolean) {
  const ed = getActiveEditor();
  const m = ed?.getModel();
  if (!ed || !m) return;
  const sels = ed.getSelections() ?? [];
  const text = sels.map((s) => m.getValueInRange(s)).join('\n');
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (cut) ed.executeEdits('keybar', sels.map((s) => ({ range: s, text: '' })));
  } catch {
    toast('warning', 'Appunti non disponibili in questo browser');
  }
}

export function TabletKeybar() {
  const keys = useApp((s) => s.settings.tabletKeySet);
  const tokens = keys.split(/\s+/).filter(Boolean);
  return (
    <div className="keybar" role="toolbar" aria-label="Tastiera rapida C">
      {tokens.map((t, i) => {
        const sp = SPECIAL[t];
        return (
          <button
            key={i}
            className={sp && sp.label.length > 2 ? 'wide' : ''}
            // pointerdown + preventDefault keeps focus (and the virtual keyboard) on the editor
            onPointerDown={(e) => {
              e.preventDefault();
              if (sp) void sp.run();
              else insert(t);
            }}
            onClick={(e) => e.preventDefault()}
            aria-label={sp ? sp.label : `Inserisci ${t}`}
          >
            {sp ? sp.label : t}
          </button>
        );
      })}
      <button className="wide hide" onPointerDown={(e) => { e.preventDefault(); void updateSettings({ tabletKeys: 'never' }); toast('info', 'Barra nascosta: riattivala da Impostazioni → Tastiera'); }} aria-label="Nascondi barra">
        <ChevronDown size={16} />
      </button>
    </div>
  );
}
