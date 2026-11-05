import Editor, { type OnMount } from '@monaco-editor/react';
import { MONACO_THEME } from '../monaco';
import { EDITOR_OPTIONS } from './editorOptions';

export interface CodeViewerProps {
  source: string;
  height?: number | string;
  language?: string;
  readOnly?: boolean;
  onChange?: (v: string) => void;
  onMount?: OnMount;
}

export default function CodeViewer({ source, height = 420, language = 'c', readOnly = true, onChange, onMount }: CodeViewerProps) {
  return (
    <div style={{ border: '1px solid var(--ag-line)', borderRadius: 4, overflow: 'hidden' }}>
      <Editor
        theme={MONACO_THEME}
        height={height}
        language={language}
        value={source}
        onChange={(v) => onChange?.(v ?? '')}
        onMount={onMount}
        options={{ ...EDITOR_OPTIONS, readOnly, domReadOnly: readOnly }}
      />
    </div>
  );
}
