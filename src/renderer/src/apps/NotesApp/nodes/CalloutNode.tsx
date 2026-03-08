import {
  ElementNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
  $applyNodeReplacement,
  $createParagraphNode
} from 'lexical'

export type CalloutType = 'note' | 'warning' | 'tip' | 'important'

export type SerializedCalloutNode = Spread<
  { calloutType: CalloutType },
  SerializedElementNode
>

const VALID_TYPES = new Set<CalloutType>(['note', 'warning', 'tip', 'important'])

export class CalloutNode extends ElementNode {
  __calloutType: CalloutType

  static getType(): string {
    return 'callout'
  }

  static clone(node: CalloutNode): CalloutNode {
    return new CalloutNode(node.__calloutType, node.__key)
  }

  constructor(calloutType: CalloutType = 'note', key?: NodeKey) {
    super(key)
    this.__calloutType = calloutType
  }

  getCalloutType(): CalloutType {
    return this.__calloutType
  }

  setCalloutType(type: CalloutType): this {
    const self = this.getWritable()
    self.__calloutType = type
    return self
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement('div')
    div.className = `editor-callout editor-callout-${this.__calloutType}`
    return div
  }

  updateDOM(prevNode: CalloutNode, dom: HTMLElement): boolean {
    if (prevNode.__calloutType !== this.__calloutType) {
      dom.className = `editor-callout editor-callout-${this.__calloutType}`
    }
    return false
  }

  exportDOM(_editor: LexicalEditor): DOMExportOutput {
    const element = document.createElement('div')
    element.className = `editor-callout editor-callout-${this.__calloutType}`
    element.setAttribute('data-callout-type', this.__calloutType)
    return { element }
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        const type = domNode.getAttribute('data-callout-type')
        if (!type || !VALID_TYPES.has(type as CalloutType)) return null
        return {
          conversion: () => ({
            node: $createCalloutNode(type as CalloutType)
          }),
          priority: 1
        }
      }
    }
  }

  static importJSON(serializedNode: SerializedCalloutNode): CalloutNode {
    return $createCalloutNode(serializedNode.calloutType)
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedCalloutNode>): this {
    return super.updateFromJSON(serializedNode).setCalloutType(serializedNode.calloutType)
  }

  exportJSON(): SerializedCalloutNode {
    return {
      ...super.exportJSON(),
      calloutType: this.__calloutType,
      type: 'callout',
      version: 1
    }
  }

  collapseAtStart(): boolean {
    const paragraph = $createParagraphNode()
    const children = this.getChildren()
    children.forEach((child) => paragraph.append(child))
    this.replace(paragraph)
    return true
  }

  canIndent(): false {
    return false
  }
}

export function $createCalloutNode(type: CalloutType = 'note'): CalloutNode {
  return $applyNodeReplacement(new CalloutNode(type))
}

export function $isCalloutNode(
  node: LexicalNode | null | undefined
): node is CalloutNode {
  return node instanceof CalloutNode
}
