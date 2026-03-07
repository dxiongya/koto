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
      <div className="absolute top-[10%] left-1/2 transform -translate-x-1/2 w-[90%] max-w-[480px] bg-[#1e1e1e] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] border border-[#333] overflow-hidden z-50 flex flex-col font-mono text-[14px]">
        <div className="px-4 py-2.5 bg-[#2d3748] flex items-center justify-between cursor-pointer">
          <span className="text-[#4fd1c5] font-medium">layout.tsx</span>
          <span className="text-[#a0aec0] text-[13px]">app</span>
        </div>
        <div className="px-4 py-2.5 hover:bg-white/5 flex items-center justify-between cursor-pointer">
          <span className="text-[#e2e8f0]">next.config.ts</span>
        </div>
        <div className="px-4 py-2.5 hover:bg-white/5 flex items-center justify-between cursor-pointer">
          <span className="text-[#e2e8f0]">package.json</span>
        </div>
        <div className="px-4 py-2.5 hover:bg-white/5 flex items-center justify-between cursor-pointer">
          <span className="text-[#e2e8f0]">page.tsx</span>
          <span className="text-[#718096] text-[13px]">app/posts/[slug]</span>
        </div>
        <div className="px-4 py-2.5 hover:bg-white/5 flex items-center justify-between cursor-pointer">
          <span className="text-[#e2e8f0]">page.tsx</span>
          <span className="text-[#718096] text-[13px]">app</span>
        </div>
        <div className="px-4 py-2.5 hover:bg-white/5 flex items-center justify-between cursor-pointer">
          <span className="text-[#e2e8f0]">styles.css</span>
          <span className="text-[#718096] text-[13px]">app</span>
        </div>
      </div>
    </>
  );
};