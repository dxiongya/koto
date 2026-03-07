import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export const liteTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#111111',
      color: '#ccc',
      height: '100%',
    },
    '.cm-content': {
      caretColor: '#5eead4',
      fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
      fontSize: '13px',
      lineHeight: '1.7',
      padding: '16px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#5eead4',
      borderLeftWidth: '2px',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255,255,255,0.03)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(91,164,164,0.2) !important',
    },
    '.cm-gutters': {
      backgroundColor: '#111111',
      color: '#444',
      borderRight: '1px solid rgba(255,255,255,0.08)',
      minWidth: '48px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255,255,255,0.05)',
      color: '#888',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 12px',
      fontSize: '13px',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(94,234,212,0.15)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(94,234,212,0.3)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'rgba(255,255,255,0.05)',
      border: 'none',
      color: '#888',
    },
    '.cm-tooltip': {
      backgroundColor: '#1e1e1e',
      border: '1px solid rgba(255,255,255,0.1)',
      color: '#ccc',
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': {
        backgroundColor: 'rgba(91,164,164,0.2)',
      },
    },
  },
  { dark: true },
)

export const liteHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: '#5eead4' },
    { tag: tags.controlKeyword, color: '#5eead4' },
    { tag: tags.moduleKeyword, color: '#5eead4' },
    { tag: tags.operatorKeyword, color: '#5eead4' },
    { tag: tags.definitionKeyword, color: '#5eead4' },
    { tag: tags.string, color: '#C4A46C' },
    { tag: tags.special(tags.string), color: '#C4A46C' },
    { tag: tags.typeName, color: '#D4A959' },
    { tag: tags.className, color: '#D4A959' },
    { tag: tags.tagName, color: '#CC8B6E' },
    { tag: tags.attributeName, color: '#fdba74' },
    { tag: tags.comment, color: '#555', fontStyle: 'italic' },
    { tag: tags.lineComment, color: '#555', fontStyle: 'italic' },
    { tag: tags.blockComment, color: '#555', fontStyle: 'italic' },
    { tag: tags.number, color: '#B5CEA8' },
    { tag: tags.bool, color: '#5eead4' },
    { tag: tags.null, color: '#5eead4' },
    { tag: tags.function(tags.variableName), color: '#fde047' },
    { tag: tags.function(tags.definition(tags.variableName)), color: '#fde047' },
    { tag: tags.propertyName, color: '#fdba74' },
    { tag: tags.definition(tags.propertyName), color: '#fdba74' },
    { tag: tags.operator, color: '#888' },
    { tag: tags.punctuation, color: '#888' },
    { tag: tags.bracket, color: '#999' },
    { tag: tags.meta, color: '#888' },
    { tag: tags.regexp, color: '#e06c75' },
  ]),
)
