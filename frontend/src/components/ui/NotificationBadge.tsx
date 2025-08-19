interface NotificationBadgeProps {
  count: number;
  className?: string;
}

export default function NotificationBadge({ count, className = '' }: NotificationBadgeProps) {
  // Don't render if count is 0 or negative
  if (count <= 0) {
    return null;
  }

  // Format large numbers (999+ -> 999+)
  const displayCount = count > 999 ? '999+' : count.toString();

  return (
    <span 
      className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-xs font-medium rounded-full transition-all duration-200 ${className}`}
      title={`${count} items need annotation`}
    >
      {displayCount}
    </span>
  );
}