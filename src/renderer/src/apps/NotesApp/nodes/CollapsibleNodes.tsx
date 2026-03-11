import {
  ElementNode,
  $createTextNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
  $createParagraphNode
} from 'lexical'

// ─── CollapsibleContainerNode ────────────────────────────────────────────────

type SerializedCollapsibleContainerNode = Spread<
  { open: boolean },
  SerializedElementNode
>

export class CollapsibleContainerNode extends ElementNode {
  __open: boolean

  constructor(open: boolean, key?: NodeKey) {
    super(key)
    this.__open = open
  }

  static getType(): string {
    return 'collapsible-container'
  }

  static clone(node: CollapsibleContainerNode): CollapsibleContainerNode {
    return new CollapsibleContainerNode(node.__open, node.__key)
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement('details')
    dom.classList.add('collapsible-container')
    dom.open = this.__open
    dom.addEventListener('toggle', () => {
      // Sync Lexical state when user toggles via native <details> click
      const isOpen = dom.open
      const editor = (dom as any).__lexicalEditor
      if (editor) {
        editor.update(() => {
          const writable = this.getWritable()
          writable.__open = isOpen
        })
      }
    })
    return dom
  }

  updateDOM(prevNode: CollapsibleContainerNode, dom: HTMLDetailsElement): boolean {
    if (prevNode.__open !== this.__open) {
      dom.open = this.__open
    }
    return false
  }

  static importJSON(json: SerializedCollapsibleContainerNode): CollapsibleContainerNode {
    return $createCollapsibleContainerNode(json.open)
  }

  exportJSON(): SerializedCollapsibleContainerNode {
    return {
      ...super.exportJSON(),
      type: 'collapsible-container',
      open: this.__open
    }
  }

  setOpen(open: boolean): void {
    const self = this.getWritable()
    self.__open = open
  }

  getOpen(): boolean {
    return this.getLatest().__open
  }

  canIndent(): boolean {
    return false
  }
}

export function $createCollapsibleContainerNode(open = true): CollapsibleContainerNode {
  return new CollapsibleContainerNode(open)
}

export function $isCollapsibleContainerNode(
  node: LexicalNode | null | undefined
): node is CollapsibleContainerNode {
  return node instanceof CollapsibleContainerNode
}

// ─── CollapsibleTitleNode ────────────────────────────────────────────────────

type SerializedCollapsibleTitleNode = SerializedElementNode

export class CollapsibleTitleNode extends ElementNode {
  static getType(): string {
    return 'collapsible-title'
  }

  static clone(node: CollapsibleTitleNode): CollapsibleTitleNode {
    return new CollapsibleTitleNode(node.__key)
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement('summary')
    dom.classList.add('collapsible-title')
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  static importJSON(_json: SerializedCollapsibleTitleNode): CollapsibleTitleNode {
    return $createCollapsibleTitleNode()
  }

  exportJSON(): SerializedCollapsibleTitleNode {
    return {
      ...super.exportJSON(),
      type: 'collapsible-title'
    }
  }

  collapseAtStart(): true {
    return true
  }
}

export function $createCollapsibleTitleNode(): CollapsibleTitleNode {
  return new CollapsibleTitleNode()
}

export function $isCollapsibleTitleNode(
  node: LexicalNode | null | undefined
): node is CollapsibleTitleNode {
  return node instanceof CollapsibleTitleNode
}

// ─── CollapsibleContentNode ─────────────────────────────────────────────────

type SerializedCollapsibleContentNode = SerializedElementNode

export class CollapsibleContentNode extends ElementNode {
  static getType(): string {
    return 'collapsible-content'
  }

  static clone(node: CollapsibleContentNode): CollapsibleContentNode {
    return new CollapsibleContentNode(node.__key)
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement('div')
    dom.classList.add('collapsible-content')
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  static importJSON(_json: SerializedCollapsibleContentNode): CollapsibleContentNode {
    return $createCollapsibleContentNode()
  }

  exportJSON(): SerializedCollapsibleContentNode {
    return {
      ...super.exportJSON(),
      type: 'collapsible-content'
    }
  }

  isShadowRoot(): boolean {
    return true
  }
}

export function $createCollapsibleContentNode(): CollapsibleContentNode {
  return new CollapsibleContentNode()
}

export function $isCollapsibleContentNode(
  node: LexicalNode | null | undefined
): node is CollapsibleContentNode {
  return node instanceof CollapsibleContentNode
}

// ─── Helper: create a complete toggle block ─────────────────────────────────

export function $createCollapsibleBlock(titleText?: string): CollapsibleContainerNode {
  const container = $createCollapsibleContainerNode(true)
  const title = $createCollapsibleTitleNode()
  const content = $createCollapsibleContentNode()
  const contentParagraph = $createParagraphNode()
  content.append(contentParagraph)
  if (titleText) {
    title.append($createTextNode(titleText))
  }
  container.append(title, content)
  return container
}
