import { branding } from '../lib/branding'
export function BrandHeader({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src={branding.logo} alt="ACM GAT Student Chapter" className={`rounded-full ${compact ? 'h-9 w-9' : 'h-16 w-16'}`} />
      <div className="leading-tight">
        <div className={`font-display font-bold ${compact ? 'text-sm' : 'text-xl'}`}>{branding.eventName}</div>
        <div className="text-[11px] text-slate-400">{branding.organizer}</div>
      </div>
    </div>
  )
}
