// Load Monaco from the bundle instead of a CDN so the app works on an offline lab network.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/edcore.main';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });

export { monaco };

// Editor theme matching docs/UI_DESIGN.md (graphite surfaces, iris accent).
monaco.editor.defineTheme('ag-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6B7891', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'A9B5FF' },
    { token: 'number', foreground: 'E3AE45' },
    { token: 'string', foreground: '7FD1AE' },
    { token: 'type', foreground: '5BB8E8' },
  ],
  colors: {
    'editor.background': '#141922',
    'editor.foreground': '#D7DEEA',
    'editorLineNumber.foreground': '#56627A',
    'editorLineNumber.activeForeground': '#B8C2D3',
    'editor.lineHighlightBackground': '#1B2230',
    'editor.selectionBackground': '#8B9CFF40',
    'editorCursor.foreground': '#8B9CFF',
    'editorIndentGuide.background1': '#232C3D',
    'editorWidget.background': '#232C3D',
    'editorWidget.border': '#2E3A50',
    'scrollbarSlider.background': '#2E3A5080',
  },
});
export const MONACO_THEME = 'ag-dark';
