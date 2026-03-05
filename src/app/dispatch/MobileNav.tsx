'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function MobileNav() {
  const pathname = usePathname();

  const navItems = [
    { name: 'Trip Sheet', path: '/dispatch', icon: '📋' },
    { name: 'Active Trip', path: '/dispatch/active', icon: '🚛' },
    { name: 'Fuel', path: '/dispatch/fuel-history', icon: '⛽' },
  ];

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0a0a0a] border-t border-zinc-800 flex justify-around items-center py-3 z-[100] safe-area-bottom shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
      {navItems.map((item) => (
        <Link 
          key={item.path} 
          href={item.path}
          className={`flex flex-col items-center gap-1 transition-all ${
            pathname === item.path ? 'text-blue-500 scale-110' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <span className="text-xl">{item.icon}</span>
          <span className="text-[10px] font-black uppercase tracking-tighter">{item.name}</span>
        </Link>
      ))}
    </div>
  );
}
