/** UI themes (CSS custom properties) and syntax colour schemes (Monaco token rules). */
import type { Settings, SyntaxScheme, UiTheme } from '../../types';

export interface UiPalette {
  bg: string;
  sidebar: string;
  panel: string;
  editor: string;
  border: string;
  text: string;
  textMuted: string;
  hover: string;
  selection: string;
  lineHighlight: string;
  error: string;
  warning: string;
  info: string;
  success: string;
  isDark: boolean;
}

export const UI_THEMES: Record<UiTheme, UiPalette & { label: string }> = {
  dark: {
    label: 'Scuro',
    bg: '#111318', sidebar: '#171A21', panel: '#1D212A', editor: '#14171D', border: '#2B303B',
    text: '#E8EAF0', textMuted: '#9299A8', hover: '#232834', selection: '#2C3A66', lineHighlight: '#1A1E26',
    error: '#FF5D65', warning: '#FFBF5F', info: '#6C8CFF', success: '#42D6B0', isDark: true,
  },
  light: {
    label: 'Chiaro',
    bg: '#F3F4F7', sidebar: '#ECEEF2', panel: '#FFFFFF', editor: '#FFFFFF', border: '#D9DCE3',
    text: '#1D2130', textMuted: '#5E6576', hover: '#E2E5EB', selection: '#CBD6FF', lineHighlight: '#F3F5FA',
    error: '#D92D3A', warning: '#B26B00', info: '#3D5FE0', success: '#138A6B', isDark: false,
  },
  oled: {
    label: 'OLED Black',
    bg: '#000000', sidebar: '#05060A', panel: '#0A0B10', editor: '#000000', border: '#1C1F27',
    text: '#E8EAF0', textMuted: '#8A90A0', hover: '#14161D', selection: '#22305A', lineHighlight: '#0B0C11',
    error: '#FF5D65', warning: '#FFBF5F', info: '#6C8CFF', success: '#42D6B0', isDark: true,
  },
};

interface TokenColors {
  keyword: string;
  type: string;
  string: string;
  number: string;
  comment: string;
  preprocessor: string;
  identifier: string;
  delimiter: string;
  operator: string;
  func: string;
}

export const SYNTAX_SCHEMES: Record<SyntaxScheme, { label: string; dark: TokenColors; light: TokenColors }> = {
  cstudio: {
    label: 'C-Studio',
    dark: { keyword: 'A48BFF', type: '42D6B0', string: 'F2C38B', number: 'F59E8B', comment: '6B7385', preprocessor: '6C8CFF', identifier: 'E8EAF0', delimiter: 'AAB1C0', operator: '9FB6FF', func: '7FD1FF' },
    light: { keyword: '6A3FD9', type: '0E8F70', string: 'A3570C', number: 'C2410C', comment: '7A8193', preprocessor: '3D5FE0', identifier: '1D2130', delimiter: '4A5163', operator: '3D5FE0', func: '0B6BA8' },
  },
  classic: {
    label: 'Classic',
    dark: { keyword: '569CD6', type: '4EC9B0', string: 'CE9178', number: 'B5CEA8', comment: '6A9955', preprocessor: 'C586C0', identifier: '9CDCFE', delimiter: 'D4D4D4', operator: 'D4D4D4', func: 'DCDCAA' },
    light: { keyword: '0000FF', type: '267F99', string: 'A31515', number: '098658', comment: '008000', preprocessor: 'AF00DB', identifier: '001080', delimiter: '000000', operator: '000000', func: '795E26' },
  },
  ember: {
    label: 'Ember',
    dark: { keyword: 'F92672', type: '66D9EF', string: 'E6DB74', number: 'AE81FF', comment: '75715E', preprocessor: 'F92672', identifier: 'F8F8F2', delimiter: 'F8F8F2', operator: 'F92672', func: 'A6E22E' },
    light: { keyword: 'D0145A', type: '0C7FA0', string: '8A7A00', number: '7B4CC4', comment: '8B8670', preprocessor: 'D0145A', identifier: '272822', delimiter: '272822', operator: 'D0145A', func: '5C8A00' },
  },
  frost: {
    label: 'Frost',
    dark: { keyword: '81A1C1', type: '8FBCBB', string: 'A3BE8C', number: 'B48EAD', comment: '616E88', preprocessor: '5E81AC', identifier: 'D8DEE9', delimiter: 'ECEFF4', operator: '81A1C1', func: '88C0D0' },
    light: { keyword: '5E81AC', type: '3B8686', string: '5F7F3A', number: '8E5A86', comment: '8A93A6', preprocessor: '4C6A92', identifier: '2E3440', delimiter: '2E3440', operator: '5E81AC', func: '2F7A8C' },
  },
};

export function resolvePalette(s: Settings): UiPalette {
  return UI_THEMES[s.theme] ?? UI_THEMES.dark;
}

/** Applies the UI theme by writing CSS custom properties on <html>. */
export function applyUiTheme(s: Settings, density: 'compact' | 'comfortable' | 'touch'): void {
  const p = resolvePalette(s);
  const r = document.documentElement;
  const vars: Record<string, string> = {
    '--bg': p.bg, '--sidebar': p.sidebar, '--panel': p.panel, '--editor': p.editor, '--border': p.border,
    '--text': p.text, '--text-muted': p.textMuted, '--hover': p.hover, '--selection': p.selection,
    '--error': p.error, '--warning': p.warning, '--info': p.info, '--success': p.success,
    '--primary': s.primaryColor, '--accent': s.accentColor,
    '--ui-font-size': `${s.uiFontSize}px`,
  };
  for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v);
  r.dataset.theme = s.theme;
  r.dataset.density = density;
  r.dataset.animations = s.animations ? 'on' : 'off';
  r.style.colorScheme = p.isDark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg);
}

/** Monaco theme definition generated from the UI palette + syntax scheme. */
export function monacoThemeData(s: Settings) {
  const p = resolvePalette(s);
  const t = SYNTAX_SCHEMES[s.syntaxScheme]?.[p.isDark ? 'dark' : 'light'] ?? SYNTAX_SCHEMES.cstudio.dark;
  return {
    base: (p.isDark ? 'vs-dark' : 'vs') as 'vs-dark' | 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: t.identifier },
      { token: 'keyword', foreground: t.keyword },
      { token: 'keyword.directive', foreground: t.preprocessor },
      { token: 'keyword.directive.include', foreground: t.preprocessor },
      { token: 'type', foreground: t.type },
      { token: 'type.identifier', foreground: t.type },
      { token: 'string', foreground: t.string },
      { token: 'string.include.identifier', foreground: t.string },
      { token: 'string.escape', foreground: t.number },
      { token: 'number', foreground: t.number },
      { token: 'number.hex', foreground: t.number },
      { token: 'number.float', foreground: t.number },
      { token: 'comment', foreground: t.comment, fontStyle: 'italic' },
      { token: 'comment.doc', foreground: t.comment, fontStyle: 'italic' },
      { token: 'identifier', foreground: t.identifier },
      { token: 'delimiter', foreground: t.delimiter },
      { token: 'delimiter.parenthesis', foreground: t.delimiter },
      { token: 'delimiter.bracket', foreground: t.delimiter },
      { token: 'delimiter.square', foreground: t.delimiter },
      { token: 'operator', foreground: t.operator },
      { token: 'annotation', foreground: t.preprocessor },
    ],
    colors: {
      'editor.background': p.editor,
      'editor.foreground': p.text,
      'editor.lineHighlightBackground': p.lineHighlight,
      'editor.lineHighlightBorder': p.lineHighlight,
      'editor.selectionBackground': p.selection,
      'editorCursor.foreground': s.primaryColor,
      'editorLineNumber.foreground': p.isDark ? '#4A5161' : '#A0A6B4',
      'editorLineNumber.activeForeground': p.text,
      'editorIndentGuide.background1': p.isDark ? '#232834' : '#E3E6ED',
      'editorIndentGuide.activeBackground1': p.isDark ? '#3A4150' : '#C4C9D4',
      'editorWidget.background': p.panel,
      'editorWidget.border': p.border,
      'editorSuggestWidget.background': p.panel,
      'editorSuggestWidget.border': p.border,
      'editorSuggestWidget.selectedBackground': p.selection,
      'editorHoverWidget.background': p.panel,
      'editorHoverWidget.border': p.border,
      'editorGutter.background': p.editor,
      'minimap.background': p.editor,
      'scrollbarSlider.background': p.isDark ? '#ffffff18' : '#00000018',
      'scrollbarSlider.hoverBackground': p.isDark ? '#ffffff28' : '#00000028',
      'editorError.foreground': p.error,
      'editorWarning.foreground': p.warning,
      'editorBracketMatch.background': p.isDark ? '#6C8CFF30' : '#3D5FE020',
      'editorBracketMatch.border': s.primaryColor,
      'diffEditor.insertedTextBackground': p.isDark ? '#42D6B022' : '#138A6B22',
      'diffEditor.removedTextBackground': p.isDark ? '#FF5D6522' : '#D92D3A22',
      focusBorder: s.primaryColor,
    },
  };
}
