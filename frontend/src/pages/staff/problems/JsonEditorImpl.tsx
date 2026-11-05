import Editor from '@monaco-editor/react';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import { MONACO_THEME } from '../../../monaco';
import { EDITOR_OPTIONS } from '../../../components';

// src/monaco.ts only wires the generic editor worker; JSON needs its own for diagnostics.
self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
};

export interface JsonEditorProps {
  value: string;
  onChange: (v: string) => void;
  height?: number | string;
  ariaLabel?: string;
}

export default function JsonEditorImpl({ value, onChange, height = 420, ariaLabel = 'rules.json' }: JsonEditorProps) {
  return (
    <div style={{ border: '1px solid var(--ag-line)', borderRadius: 4, overflow: 'hidden' }}>
      <Editor
        theme={MONACO_THEME}
        height={height}
        language="json"
        value={value}
        onChange={(v) => onChange(v ?? '')}
        options={{ ...EDITOR_OPTIONS, tabSize: 2, ariaLabel, formatOnPaste: true }}
      />
    </div>
  );
}
