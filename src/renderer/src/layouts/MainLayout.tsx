import React, { useState } from 'react';
import { PanelLeft } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { CommandPalette } from '../components/CommandPalette';
import { ResizeHandle } from '../components/ResizeHandle';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore } from '../store/useUIStore';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const [sidebarWidth, setSidebarWidth] = useState(262);

  return (
    <div className="w-screen h-screen flex font-mono overflow-hidden bg-bg-app text-tx-main">
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.div
            key="sidebar"
            initial={{ marginLeft: -sidebarWidth, opacity: 0 }}
            animate={{ marginLeft: 0, opacity: 1 }}
            exit={{ marginLeft: -sidebarWidth, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0.25, duration: 0.4 }}
            className="shrink-0 h-full flex relative z-10 shadow-sm"
            style={{ width: sidebarWidth }}
          >
            <div className="flex flex-1 border-r border-border-subtle overflow-hidden">
              <Sidebar />
            </div>
            <ResizeHandle
              side="left"
              width={sidebarWidth}
              onResize={setSidebarWidth}
              minWidth={180}
              maxWidth={420}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex-1 flex flex-col relative bg-bg-app overflow-hidden z-0">
        <TopStrip />
        <div className="flex-1 flex flex-col relative overflow-hidden">
          {children}
        </div>
      </div>
      <CommandPalette />
    </div>
  );
};

/**
 * Slim top strip: drag region for macOS titlebar + sidebar toggle.
 * In Single mode (no tabs), also shows a path breadcrumb so the user still
 * sees "what is open". In Tabs mode, the breadcrumb is redundant with the
 * tab chip below and is hidden.
 */
const TopStrip: React.FC = () => {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const contentLayoutMode = useUIStore((s) => s.contentLayoutMode);
  const currentApp = useUIStore((s) => s.currentApp);
  const activeFilePath = useUIStore((s) => s.getActiveFilePath());
  const liteHome = useUIStore((s) => s.liteHome);
  const codeProjectPath = useUIStore((s) => s.codeProjectPath);

  const showBreadcrumb =
    contentLayoutMode === 'single' && currentApp !== 'settings.app';

  const crumbs: string[] = [];
  if (showBreadcrumb) {
    crumbs.push(currentApp);
    if (activeFilePath) {
      let rel = activeFilePath;
      if (liteHome && activeFilePath.startsWith(liteHome)) {
        rel = activeFilePath.slice(liteHome.length + 1);
      } else if (codeProjectPath && activeFilePath.startsWith(codeProjectPath)) {
        rel = activeFilePath.slice(codeProjectPath.length + 1);
      }
      crumbs.push(...rel.split('/').filter(Boolean));
    }
  }

  return (
    <div
      className={`shrink-0 h-8 flex items-center gap-3 transition-[padding] ${
        !sidebarOpen ? 'pl-[82px]' : 'pl-2'
      } pr-3`}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <button
        onClick={toggleSidebar}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="p-1 rounded hover:bg-bg-hover text-tx-faint hover:text-tx-main transition-colors shrink-0"
        aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        title={sidebarOpen ? 'Hide Sidebar (⌘B)' : 'Show Sidebar (⌘B)'}
      >
        <PanelLeft size={14} strokeWidth={1.5} />
      </button>

      {showBreadcrumb && crumbs.length > 0 && (
        <div className="flex items-center gap-1.5 min-w-0 text-[12px] text-tx-muted truncate">
          {crumbs.map((seg, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-tx-faint">/</span>}
              <span
                className={`truncate ${
                  i === crumbs.length - 1 ? 'text-tx-main' : ''
                }`}
              >
                {seg}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};