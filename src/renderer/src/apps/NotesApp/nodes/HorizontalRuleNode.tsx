import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  $applyNodeReplacement,
  $getNodeByKey,
  $createParagraphNode,
  COMMAND_PRIORITY_LOW,
  CLICK_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND
} from 'lexical'
import type { ElementTransformer } from '@lexical/markdown'
import { useEffect, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import { mergeRegister } from '@lexical/utils'

export type SerializedHorizontalRuleNode = SerializedLexicalNode

export class HorizontalRuleNode extends DecoratorNode<JSX.Element> {
  static getType(): string {
    return 'horizontal-rule'
  }

  static clone(node: HorizontalRuleNode): HorizontalRuleNode {
    return new HorizontalRuleNode(node.__key)
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  exportJSON(): SerializedHorizontalRuleNode {
    return { type: 'horizontal-rule', version: 1 }
  }

  static importJSON(): HorizontalRuleNode {
    return $createHorizontalRuleNode()
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('hr') }
  }

  static importDOM(): DOMConversionMap | null {
    return {
      hr: () => ({
        conversion: () => ({ node: $createHorizontalRuleNode() }),
        priority: 0
      })
    }
  }

  isInline(): boolean {
    return false
  }

  createDOM(): HTMLElement {
    return document.createElement('div')
  }

  updateDOM(): boolean {
    return false
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): JSX.Element {
    return <HorizontalRuleComponent nodeKey={this.getKey()} />
  }
}

function HorizontalRuleComponent({ nodeKey }: { nodeKey: NodeKey }): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (event) => {
          if ((event.target as HTMLElement).closest(`[data-hr-key="${nodeKey}"]`)) {
            clearSelection()
            setSelected(true)
            event.preventDefault()
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        (payload) => {
          if (isSelected) {
            payload.preventDefault()
            editor.update(() => {
              const node = $getNodeByKey(nodeKey)
              if (node) node.remove()
            })
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (payload) => {
          if (isSelected) {
            payload.preventDefault()
            editor.update(() => {
              const node = $getNodeByKey(nodeKey)
              if (node) node.remove()
            })
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (payload) => {
          if (!isSelected) return false
          payload?.preventDefault()
          editor.update(() => {
            const node = $getNodeByKey(nodeKey)
            if (!node) return
            const paragraph = $createParagraphNode()
            node.insertAfter(paragraph)
            paragraph.selectStart()
          })
          return true
        },
        COMMAND_PRIORITY_LOW
      )
    )
  }, [isSelected, editor, clearSelection, setSelected, nodeKey])

  return (
    <div data-hr-key={nodeKey} className="py-3 cursor-pointer">
      <hr
        className={`border-0 h-[1px] transition-colors ${
          isSelected ? 'bg-[#5eead4]' : 'bg-white/10'
        }`}
      />
    </div>
  )
}

export function $createHorizontalRuleNode(): HorizontalRuleNode {
  return $applyNodeReplacement(new HorizontalRuleNode())
}

export function $isHorizontalRuleNode(
  node: LexicalNode | null | undefined
): node is HorizontalRuleNode {
  return node instanceof HorizontalRuleNode
}

export const HR_TRANSFORMER: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => {
    return $isHorizontalRuleNode(node) ? '---' : null
  },
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, _match, isImport) => {
    const hrNode = $createHorizontalRuleNode()
    if (isImport || parentNode.getNextSibling() != null) {
      parentNode.replace(hrNode)
    } else {
      parentNode.insertBefore(hrNode)
    }
    hrNode.selectNext()
  },
  type: 'element'
}
