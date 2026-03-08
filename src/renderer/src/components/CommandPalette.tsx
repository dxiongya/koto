import React from 'react';
import { useUIStore } from '../store/useUIStore';

export const CommandPalette: React.FC = () => {
  const showCommandPalette = useUIStore((state) => state.showCommandPalette);
  const setShowCommandPalette = useUIStore((state) => state.setShowCommandPalette);

  if (!showCommandPalette) return null;

  return (
    <>
      <div 
        className="absolute inset-0 z-40 bg-transparent" 
        onClick={() => setShowCommandPalette(false)}
      />
      <div className="absolute top-[10%] left-1/2 transform -translate-x-1/2 w-[90%] max-w-[480px] bg-bg-popover rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] border border-border-strong overflow-hidden z-50 flex flex-col font-mono text-[14px]">
        <div className="px-4 py-2.5 bg-accent-bg flex items-center justify-between cursor-pointer">
          <span className="text-accent-main font-medium">layout.tsx</span>
          <span className="text-accent-main/70 text-[13px]">app</span>
        </div>
        <div className="px-4 py-2.5 hover:bg-bg-hover flex items-center justify-between cursor-pointer">
          <span className="text-tx-main">next.config.ts</span>
        </div>
        <div className="px-4 py-2.5 hover:bg-bg-hover flex items-center justify-between cursor-pointer">
          <span className="text-tx-main">package.json</span>
        </div>
        <div className="px-4 py-2.5 hover:bg-bg-hover flex items-center justify-between cursor-pointer">
          <span className="text-tx-main">page.tsx</span>
          <span className="text-tx-muted text-[13px]">app/posts/[slug]</span>
        </div>
        <div className="px-4 py-2.5 hover:bg-bg-hover flex items-center justify-between cursor-pointer">
          <span className="text-tx-main">page.tsx</span>
          <span className="text-tx-muted text-[13px]">app</span>
        </div>
        <div className="px-4 py-2.5 hover:bg-bg-hover flex items-center justify-between cursor-pointer">
          <span className="text-tx-main">styles.css</span>
          <span className="text-tx-muted text-[13px]">app</span>
        </div>
      </div>
    </>
  );
};