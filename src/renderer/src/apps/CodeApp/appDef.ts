import type { AppDefinition } from '../../../../shared/app-interface'
import { CodeApp } from './index'

export const codeAppDefinition: AppDefinition = {
  manifest: {
    id: 'code.app',
    name: 'Code',
    icon: 'layout-template',
    version: '1.0.0',
    description: 'Code editor with syntax highlighting',
    permissions: ['fs', 'state'],
    builtin: true,
  },
  component: CodeApp as React.FC<{ api: any }>,
  sidebar: {
    expandable: true,
  },
}
