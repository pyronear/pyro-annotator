import { Contributor } from '@/types/api';

interface ContributorListProps {
  contributors?: Contributor[];
  displayMode?: 'compact' | 'pills';
  className?: string;
}

export default function ContributorList({ 
  contributors, 
  displayMode = 'compact',
  className = '' 
}: ContributorListProps) {
  if (!contributors || contributors.length === 0) {
    return null;
  }

  // Deduplicate contributors by username
  const uniqueContributors = contributors.filter((contributor, index, self) =>
    self.findIndex(c => c.username === contributor.username) === index
  );

  if (displayMode === 'pills') {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <span className="text-xs text-gray-500">👥</span>
        <div className="flex flex-wrap gap-1">
          {uniqueContributors.map((contributor) => (
            <span
              key={contributor.id}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
              title={`Contributor: ${contributor.username}`}
            >
              {contributor.username}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Compact mode - comma-separated usernames
  const usernames = uniqueContributors.map(c => c.username).join(', ');
  
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <span className="text-xs text-gray-500">👥</span>
      <span 
        className="text-xs text-gray-600"
        title={`Contributors: ${usernames}`}
      >
        {usernames}
      </span>
    </div>
  );
}