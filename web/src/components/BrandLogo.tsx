interface BrandLogoProps {
  showIcon?: boolean;
  showTagline?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const BrandLogo = ({ showIcon = true, showTagline = false, size = "md", className = "" }: BrandLogoProps) => {
  const sizeClasses = {
    sm: {
      icon: "w-8 h-8",
      text: "text-lg",
      tagline: "text-[7px]",
    },
    md: {
      icon: "w-10 h-10",
      text: "text-xl",
      tagline: "text-[8px]",
    },
    lg: {
      icon: "w-12 h-12",
      text: "text-2xl",
      tagline: "text-[9px]",
    },
  };

  const s = sizeClasses[size];

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {showIcon && (
        <div className={`relative ${s.icon}`}>
          <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full fill-none animate-pulse" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="45" stroke="url(#neural-grad)" strokeWidth="4" strokeDasharray="10 5" />
            <defs>
              <linearGradient id="neural-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00F5FF" />
                <stop offset="100%" stopColor="#8B5CF6" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-white shadow-[0_0_15px_rgba(255,255,255,0.8)]" />
          </div>
        </div>
      )}
      <div className="flex flex-col">
        <span className={`font-bold tracking-tighter ${s.text} leading-none`}>
          Code<span className="text-[#00F5FF]">Zero</span>
        </span>
        {showTagline && (
          <span className={`${s.tagline} uppercase tracking-[0.3em] text-slate-500 font-black leading-none mt-0.5`}>
            Claude Code Console
          </span>
        )}
      </div>
    </div>
  );
};

export const BrandName = ({ className = "" }: { className?: string }) => (
  <span className={className}>
    Code<span className="text-[#00F5FF]">Zero</span>
  </span>
);

export default BrandLogo;
