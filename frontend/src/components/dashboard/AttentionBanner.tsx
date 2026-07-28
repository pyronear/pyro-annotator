import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

interface AttentionBannerProps {
  count: number;
}

export default function AttentionBanner({ count }: AttentionBannerProps) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-signal/30 border-l-[3px] border-l-signal bg-signal-soft px-3.5 py-2.5 font-body text-[13px] text-signal">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        {count} sequence{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} manual attention
      </span>
      <Link to="/sequences/attention" className="ml-auto font-semibold hover:underline">
        Resolve →
      </Link>
    </div>
  );
}
