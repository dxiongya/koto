import React, { useState } from 'react';
import { Header } from './Header';
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
        <Header />
        <div className="flex-1 flex flex-col relative overflow-hidden">
          {children}
        </div>
      </div>
      <CommandPalette />
    </div>
  );
};