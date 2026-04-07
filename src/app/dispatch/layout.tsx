import GlobalNav from './GlobalNav';

export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      {/* Animated grid background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-zinc-950" />
        
        {/* Subtle animated grid */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />
        
        {/* Top glow - emerald */}
        <div 
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full opacity-[0.07]"
          style={{
            background: 'radial-gradient(ellipse, rgba(16,185,129,0.3) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
        
        {/* Bottom left glow - blue */}
        <div 
          className="absolute bottom-0 -left-40 w-[500px] h-[400px] rounded-full opacity-[0.05]"
          style={{
            background: 'radial-gradient(ellipse, rgba(59,130,246,0.3) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
        
        {/* Right glow - purple */}
        <div 
          className="absolute top-1/3 -right-40 w-[400px] h-[500px] rounded-full opacity-[0.04]"
          style={{
            background: 'radial-gradient(ellipse, rgba(139,92,246,0.3) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
        
        {/* Noise texture overlay */}
        <div className="absolute inset-0 opacity-[0.015]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }} />
      </div>
      
      {/* Content */}
      <div className="relative z-10">
        <GlobalNav />
        {children}
      </div>
    </div>
  );
}
