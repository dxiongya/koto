import type { JSX } from 'react'
import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'

export type SerializedGhostTextNode = Spread<
  { text: string },
  SerializedLexicalNode
>

/**
 * GhostTextNode — A DecoratorNode for displaying AI ghost-text completions
 * inline in the editor.
 *
 * Key properties:
 * - isInline: true → flows inline with text in any parent (paragraph, code, list, etc.)
 * - getTextContent: '' → invisible to markdown export and auto-save
 * - Not serialized to JSON (transient only)
 * - decorate() renders a React <span> with ghost styling
 */
export class GhostTextNode extends DecoratorNode<JSX.Element> {
  __text: string

  static getType(): string {
    return 'ghost-text'
  }

  static clone(node: GhostTextNode): GhostTextNode {
    return new GhostTextNode(node.__text, node.__key)
  }

  constructor(text: string, key?: NodeKey) {
    super(key)
    this.__text = text
  }

  // ── DOM ──

  createDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'ghost-text-inline'
    span.setAttribute('data-lexical-decorator', 'true')
    span.contentEditable = 'false'
    return span
  }

  updateDOM(): boolean {
    return false
  }

  exportDOM(): DOMExportOutput {
    return { element: null } // never export to HTML
  }

  static importDOM(): DOMConversionMap | null {
    return null // never import from HTML
  }

  // ── Node properties ──

  isInline(): boolean {
    return true
  }

  /** Return empty so ghost text doesn't appear in getTextContent / markdown export */
  getTextContent(): string {
    return ''
  }

  getText(): string {
    return this.__text
  }

  // ── Serialization (transient — we don't persist ghost nodes) ──

  exportJSON(): SerializedGhostTextNode {
    return { ...super.exportJSON(), text: this.__text, type: 'ghost-text', version: 1 }
  }

  static importJSON(json: SerializedGhostTextNode): GhostTextNode {
    return new GhostTextNode(json.text)
  }

  // ── Decoration ──

  decorate(): JSX.Element {
    return <span className="ghost-text-inline">{this.__text}</span>
  }
}

export function $createGhostTextNode(text: string): GhostTextNode {
  return new GhostTextNode(text)
}

export function $isGhostTextNode(node: LexicalNode | null | undefined): node is GhostTextNode {
  return node instanceof GhostTextNode
}
