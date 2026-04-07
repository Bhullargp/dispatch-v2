'use client';

import React from 'react';

interface FloatingAddButtonProps {
  onClick: () => void;
}

export default function FloatingAddButton({ onClick }: FloatingAddButtonProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-24 md:bottom-8 right-5 z-[110] bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-full h-16 w-16 flex items-center justify-center shadow-lg active:scale-95 transition-all"
      aria-label="Open Quick Add Panel"
    >
      <span className="text-2xl">⚡</span>
    </button>
  );
}
