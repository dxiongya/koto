import React from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { CommandPalette } from '../components/CommandPalette';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <div className="w-screen h-screen flex font-mono overflow-hidden bg-[#111111] text-[#a1a1aa]">
      <Sidebar />
      <div className="flex-1 flex flex-col relative bg-[#111111] overflow-hidden">
        <Header />
        <div className="flex-1 flex flex-col relative overflow-hidden">
          {children}
        </div>
        <CommandPalette />
      </div>
    </div>
  );
};