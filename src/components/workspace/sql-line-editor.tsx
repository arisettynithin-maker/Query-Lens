"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { editor as MonacoEditor } from "monaco-editor";

import { cn } from "@/lib/utils";

export type SqlLineEditorHandle = {
  focusLine: (line: number) => void;
  focusEditor: () => void;
};

type SqlLineEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  sqlMode?: boolean;
};

const THEME_NAME = "querylens-sql-dark";

export const SqlLineEditor = forwardRef<SqlLineEditorHandle, SqlLineEditorProps>(
  ({ value, onChange, placeholder, className, sqlMode = true }, ref) => {
    const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
    const jumpDecorationRef = useRef<string[]>([]);
    const clearHighlightTimer = useRef<NodeJS.Timeout | null>(null);
    const pendingLineFocusRef = useRef<number | null>(null);
    const [isFocused, setIsFocused] = useState(false);

    const applyJumpLineDecoration = (line: number) => {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco) return;

      const model = editor.getModel();
      if (!model) return;

      const safeLine = Math.max(1, Math.min(model.getLineCount(), line));

      jumpDecorationRef.current = editor.deltaDecorations(jumpDecorationRef.current, [
        {
          range: new monaco.Range(safeLine, 1, safeLine, 1),
          options: {
            isWholeLine: true,
            className: "querylens-monaco-jump-line",
            linesDecorationsClassName: "querylens-monaco-jump-line-glyph",
          },
        },
      ]);

      if (clearHighlightTimer.current) clearTimeout(clearHighlightTimer.current);
      clearHighlightTimer.current = setTimeout(() => {
        if (!editorRef.current) return;
        jumpDecorationRef.current = editorRef.current.deltaDecorations(
          jumpDecorationRef.current,
          [],
        );
      }, 1600);
    };

    const focusLine = useCallback((line: number) => {
      const editor = editorRef.current;
      if (!editor) {
        pendingLineFocusRef.current = line;
        return;
      }
      const model = editor.getModel();
      if (!model) return;

      const safeLine = Math.max(1, Math.min(model.getLineCount(), line));
      editor.revealLineInCenter(safeLine);
      editor.setPosition({ lineNumber: safeLine, column: 1 });
      editor.focus();
      applyJumpLineDecoration(safeLine);
    }, []);

    const focusEditor = useCallback(() => {
      editorRef.current?.focus();
    }, []);

    useImperativeHandle(ref, () => ({ focusLine, focusEditor }), [focusLine, focusEditor]);

    const beforeMount = (monaco: typeof import("monaco-editor")) => {
      monaco.editor.defineTheme(THEME_NAME, {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "keyword", foreground: "93C5FD", fontStyle: "bold" },
          { token: "keyword.sql", foreground: "93C5FD", fontStyle: "bold" },
          { token: "predefined.sql", foreground: "67E8F9" },
          { token: "number", foreground: "FBBF24" },
          { token: "string", foreground: "86EFAC" },
          { token: "comment", foreground: "6B7A99", fontStyle: "italic" },
          { token: "operator.sql", foreground: "94A3B8" },
          { token: "identifier", foreground: "E5E7EB" },
        ],
        colors: {
          "editor.background": "#111827",
          "editor.foreground": "#E5E7EB",
          "editorLineNumber.foreground": "#6B7280",
          "editorLineNumber.activeForeground": "#D1D5DB",
          "editorGutter.background": "#0F172A",
          "editorCursor.foreground": "#F9FAFB",
          "editor.lineHighlightBackground": "#1F2937",
          "editor.selectionBackground": "#1D4ED84A",
          "editor.inactiveSelectionBackground": "#33415566",
          "editorIndentGuide.background1": "#1F2937",
          "editorIndentGuide.activeBackground1": "#374151",
        },
      });
    };

    const handleMount: OnMount = (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      editor.onDidFocusEditorText(() => setIsFocused(true));
      editor.onDidBlurEditorText(() => setIsFocused(false));

      if (pendingLineFocusRef.current !== null) {
        focusLine(pendingLineFocusRef.current);
        pendingLineFocusRef.current = null;
      }
    };

    useEffect(
      () => () => {
        if (clearHighlightTimer.current) clearTimeout(clearHighlightTimer.current);
      },
      [],
    );

    return (
      <div className={cn("relative w-full overflow-hidden rounded-lg border border-[#374151]", className)}>
        {!value.trim() && !isFocused ? (
          <div className="pointer-events-none absolute left-[58px] top-3 z-10 max-w-[80%] text-[13px] leading-relaxed text-slate-400/70">
            {placeholder}
          </div>
        ) : null}
        <Editor
          height="340px"
          defaultLanguage={sqlMode ? "sql" : "plaintext"}
          language={sqlMode ? "sql" : "plaintext"}
          theme={THEME_NAME}
          value={value}
          beforeMount={beforeMount}
          onMount={handleMount}
          onChange={(newValue) => onChange(newValue ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineHeight: 21,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            fontLigatures: false,
            lineNumbers: "on",
            readOnly: false,
            contextmenu: true,
            smoothScrolling: true,
            cursorBlinking: "solid",
            cursorSmoothCaretAnimation: "on",
            renderLineHighlight: "line",
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            scrollBeyondLastLine: false,
            wordWrap: "off",
            automaticLayout: true,
            tabSize: 2,
            insertSpaces: true,
            glyphMargin: false,
            folding: false,
            bracketPairColorization: { enabled: true },
            suggestOnTriggerCharacters: false,
            quickSuggestions: false,
            scrollbar: {
              verticalScrollbarSize: 9,
              horizontalScrollbarSize: 9,
            },
            padding: {
              top: 12,
              bottom: 12,
            },
          }}
          className="querylens-monaco-editor"
        />
        <style jsx global>{`
          .querylens-monaco-editor,
          .querylens-monaco-editor .monaco-editor,
          .querylens-monaco-editor .overflow-guard {
            background: #111827 !important;
          }
          .querylens-monaco-editor .monaco-editor .margin,
          .querylens-monaco-editor .monaco-editor-background {
            background: #111827 !important;
          }
          .querylens-monaco-editor .monaco-editor .margin {
            border-right: 1px solid #334155 !important;
          }
          .querylens-monaco-jump-line {
            background: rgba(250, 204, 21, 0.38) !important;
            outline: 1px solid rgba(250, 204, 21, 0.32);
          }
          .querylens-monaco-jump-line-glyph {
            border-left: 2px solid rgba(250, 204, 21, 0.8);
          }
        `}</style>
      </div>
    );
  },
);

SqlLineEditor.displayName = "SqlLineEditor";

