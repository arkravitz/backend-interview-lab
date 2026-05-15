'use client';
import { useMemo } from 'react';
import CodeMirror, { EditorState, EditorView } from '@uiw/react-codemirror';
import { Decoration, WidgetType } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { lightHighlighting } from '@/lib/python-highlight';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';
import type { Proposal, SuggestedEdit } from '@/lib/review';

class EditWidget extends WidgetType {
  constructor(
    readonly edit: SuggestedEdit,
    readonly index: number,
    readonly accept: (index: number) => void,
    readonly reject: (index: number) => void,
  ) {
    super();
  }
  toDOM() {
    const node = document.createElement('div');
    node.className = 'inline-edit';
    const bar = document.createElement('div');
    bar.className = 'inline-edit-actions';
    const label = document.createElement('span');
    label.textContent = this.edit.explanation;
    bar.appendChild(label);
    for (const [name, action] of [
      ['Accept', this.accept],
      ['Reject', this.reject],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.setAttribute('aria-label', `${name} edit ${this.index + 1}`);
      button.className = name === 'Accept' ? 'accept-edit' : 'reject-edit';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        action(this.index);
      });
      bar.appendChild(button);
    }
    node.appendChild(bar);
    if (this.edit.after) {
      const added = document.createElement('pre');
      added.className = 'added-code';
      added.textContent = this.edit.after;
      node.appendChild(added);
    } else {
      const note = document.createElement('div');
      note.className = 'added-code';
      note.textContent = 'Remove the highlighted code above';
      node.appendChild(note);
    }
    return node;
  }
  ignoreEvent() {
    return true;
  }
}
const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--foreground)',
    fontSize: '14px',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    lineHeight: '1.65',
    overflow: 'auto',
  },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--primary)' },
  '.cm-line': { padding: '0 14px' },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: '#718096',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'var(--editor-active)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-line.removed-line': { backgroundColor: 'var(--diff-removed)' },
  '.removed-code': {
    textDecoration: 'line-through',
    textDecorationColor: '#d45b65',
  },
});
export function PythonCode({
  value,
  onChange,
  onRun,
  readOnly = false,
  disabled = false,
  label = 'Python code',
  dark = false,
  assist = false,
  proposal,
  onAccept,
  onReject,
}: {
  value: string;
  onChange?: (v: string) => void;
  onRun?: () => void;
  readOnly?: boolean;
  disabled?: boolean;
  label?: string;
  dark?: boolean;
  assist?: boolean;
  proposal?: Proposal | null;
  onAccept?: (i: number) => void;
  onReject?: (i: number) => void;
}) {
  const extensions = useMemo(() => {
    const decorations = [];
    if (proposal && proposal.base === value && onAccept && onReject) {
      const doc = EditorState.create({ doc: value }).doc;
      const lines = new Set<number>();
      proposal.edits.forEach((edit, i) => {
        const from = value.indexOf(edit.before);
        if (from < 0) return;
        const to = from + edit.before.length;
        decorations.push(
          Decoration.mark({ class: 'removed-code' }).range(from, to),
        );
        for (
          let n = doc.lineAt(from).number;
          n <= doc.lineAt(Math.max(from, to - 1)).number;
          n++
        )
          lines.add(doc.line(n).from);
        decorations.push(
          Decoration.widget({
            widget: new EditWidget(edit, i, onAccept, onReject),
            block: true,
            side: 1,
          }).range(doc.lineAt(Math.max(from, to - 1)).to),
        );
      });
      for (const from of lines)
        decorations.push(
          Decoration.line({ class: 'removed-line' }).range(from),
        );
    }
    return [
      python(),
      // oneDark brings its own highlighting in dark mode; light mode needs one.
      ...(dark ? [] : [lightHighlighting]),
      // lang-python already ships keyword, builtin, module and structural
      // snippet completions, but they only surface if the UI extension is
      // present. Off by default: a practice interview is meant to be typed
      // unaided, and the toggle sits in the editor toolbar. This governs the
      // completion popup only; closing brackets is unconditional and lives in
      // basicSetup below.
      ...(assist ? [autocompletion(), keymap.of([...completionKeymap])] : []),
      editorTheme,
      EditorState.tabSize.of(4),
      EditorView.contentAttributes.of({
        'aria-label': label,
        ...(readOnly ? { 'aria-readonly': 'true', tabindex: '0' } : {}),
      }),
      EditorView.decorations.of(Decoration.set(decorations, true)),
      ...(readOnly ? [EditorView.lineWrapping] : []),
    ];
  }, [label, readOnly, value, proposal, onAccept, onReject, dark, assist]);
  return (
    <CodeMirror
      className={readOnly ? 'python-example' : 'python-editor'}
      value={value}
      theme={dark ? oneDark : 'light'}
      extensions={extensions}
      height={readOnly ? undefined : '100%'}
      readOnly={readOnly || disabled}
      editable={!readOnly && !disabled}
      indentWithTab={!readOnly}
      basicSetup={
        readOnly
          ? false
          : {
              tabSize: 4,
              // Brackets and quotes always close; the toolbar toggle governs
              // completions only. Stated explicitly rather than left to the
              // wrapper's default, which happens to be on but is not part of
              // its documented options.
              closeBrackets: true,
              closeBracketsKeymap: true,
              autocompletion: false,
              foldGutter: true,
              highlightSelectionMatches: false,
            }
      }
      onChange={onChange}
      onKeyDownCapture={(e) => {
        if (
          !readOnly &&
          !disabled &&
          e.key === 'Enter' &&
          (e.metaKey || e.ctrlKey)
        ) {
          e.preventDefault();
          e.stopPropagation();
          onRun?.();
        }
      }}
    />
  );
}
