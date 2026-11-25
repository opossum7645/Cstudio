import { useEffect, useRef } from 'react';
import { monaco, getModel, registerEditor, editorOptions, refreshMarkers } from '../../editor/monaco';
import { useApp, saveFile, isDirty } from '../../stores/appStore';
import { useDebug, debugActions } from '../../features/debugger/debugStore';

const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();

export function CodeEditor({ group, path, touch }: { group: number; path: string; touch: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const edRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const pathRef = useRef(path);
  const bpDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const dbgDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const hoverDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const settings = useApp((s) => s.settings);
  const breakpoints = useApp((s) => s.project?.breakpoints[path]);
  const verified = useDebug((s) => s.verified[path]);
  const debugLoc = useDebug((s) => (s.status === 'stopped' ? s.frames[s.selectedFrame] ?? s.location : null));
  const reveal = useApp((s) => s.revealRequest);

  // create editor once
  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.create(host.current, { ...editorOptions(useApp.getState().settings, touch), model: null, theme: 'cstudio' });
    edRef.current = ed;
    bpDecos.current = ed.createDecorationsCollection();
    dbgDecos.current = ed.createDecorationsCollection();
    hoverDecos.current = ed.createDecorationsCollection();
    registerEditor(group, ed);
    const subs = [
      ed.onDidFocusEditorText(() => {
        if (useApp.getState().activeGroup !== group) useApp.setState({ activeGroup: group });
      }),
      ed.onDidBlurEditorText(() => {
        const st = useApp.getState();
        if (st.settings.autoSave === 'onFocusChange' && isDirty(pathRef.current)) void saveFile(pathRef.current);
      }),
      ed.onDidChangeCursorSelection((e) => {
        const sel = e.selection;
        const model = ed.getModel();
        useApp.setState({ cursor: { line: sel.positionLineNumber, column: sel.positionColumn, selection: model ? model.getValueInRange(sel).length : 0 } });
      }),
      ed.onMouseDown((e) => {
        const t = e.target.type;
        const isGlyph = t === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
        const isLineNo = t === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS && touch;
        if ((isGlyph || isLineNo) && e.target.position) void debugActions.toggleBreakpoint(pathRef.current, e.target.position.lineNumber);
      }),
      ed.onMouseMove((e) => {
        const glyph = e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position;
        hoverDecos.current?.set(glyph ? [{ range: new monaco.Range(glyph.lineNumber, 1, glyph.lineNumber, 1), options: { glyphMarginClassName: 'bp-hint' } }] : []);
      }),
    ];
    return () => {
      viewStates.set(pathRef.current, ed.saveViewState());
      subs.forEach((s) => s.dispose());
      registerEditor(group, null);
      ed.dispose();
      edRef.current = null;
    };
  }, [group, touch]);

  // switch model when the active file changes
  useEffect(() => {
    const ed = edRef.current;
    if (!ed) return;
    const prev = pathRef.current;
    if (ed.getModel() && prev !== path) viewStates.set(prev, ed.saveViewState());
    pathRef.current = path;
    const model = getModel(path);
    if (ed.getModel() !== model) {
      ed.setModel(model);
      const vs = viewStates.get(path);
      if (vs) ed.restoreViewState(vs);
      refreshMarkers();
    }
    if (useApp.getState().activeGroup === group && !touch) ed.focus();
  }, [path, group, touch]);

  // settings → options
  useEffect(() => {
    edRef.current?.updateOptions(editorOptions(settings, touch));
  }, [settings, touch]);

  // breakpoints
  useEffect(() => {
    const lines = breakpoints ?? [];
    const ok = new Set(verified ?? []);
    const debugging = useDebug.getState().status !== 'idle' && useDebug.getState().status !== 'ended';
    bpDecos.current?.set(
      lines.map((l) => ({
        range: new monaco.Range(l, 1, l, 1),
        options: { glyphMarginClassName: `bp-glyph ${debugging && !ok.has(l) ? 'unverified' : ''}`, glyphMarginHoverMessage: { value: `Breakpoint riga ${l}` }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
      })),
    );
  }, [breakpoints, verified, path]);

  // current debug line
  useEffect(() => {
    const ed = edRef.current;
    if (!ed) return;
    if (debugLoc && debugLoc.file === path && debugLoc.line > 0) {
      dbgDecos.current?.set([{ range: new monaco.Range(debugLoc.line, 1, debugLoc.line, 1), options: { isWholeLine: true, className: 'debug-line', glyphMarginClassName: 'debug-glyph' } }]);
      ed.revealLineInCenterIfOutsideViewport(debugLoc.line);
    } else dbgDecos.current?.set([]);
  }, [debugLoc, path]);

  // reveal requests (problems, search, go to definition)
  useEffect(() => {
    const ed = edRef.current;
    if (!ed || !reveal || reveal.path !== path || useApp.getState().activeGroup !== group) return;
    const pos = { lineNumber: reveal.line, column: reveal.column };
    ed.setPosition(pos);
    ed.revealPositionInCenter(pos);
    ed.focus();
  }, [reveal, path, group]);

  return <div ref={host} className="monaco-host" data-testid={`editor-${group}`} />;
}
