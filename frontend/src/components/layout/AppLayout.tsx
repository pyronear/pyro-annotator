import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, MoreVertical, X, LogOut, User, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { useAnnotationCounts } from '@/hooks/useAnnotationCounts';
import NotificationBadge from '@/components/ui/NotificationBadge';
import { useAuthStore } from '@/store/useAuthStore';
import logoImg from '@/assets/logo.png';

interface AppLayoutProps {
  children: React.ReactNode;
}

interface NavigationItem {
  name: string;
  children: NavigationSubItem[];
}

interface NavigationSubItem {
  name: string;
  href: string;
  badgeCount?: number;
  badgeTitle?: string;
}

// Navigation structure is now dynamically generated in SidebarContent to include badge counts

export default function AppLayout({ children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="h-screen flex overflow-hidden bg-ash">
      {/* Mobile menu overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 flex z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-600 bg-opacity-75" aria-hidden="true"></div>
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white">
            <div className="absolute top-0 right-0 -mr-12 pt-2">
              <button
                type="button"
                className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
                onClick={() => setSidebarOpen(false)}
              >
                <span className="sr-only">Close sidebar</span>
                <X className="h-6 w-6 text-white" aria-hidden="true" />
              </button>
            </div>
            <SidebarContent currentPath={location.pathname} />
          </div>
          <div className="flex-shrink-0 w-14">
            {/* Force sidebar to shrink to fit close icon */}
          </div>
        </div>
      )}

      {/* Static sidebar for desktop */}
      <div className="hidden md:flex md:flex-shrink-0">
        <div className="flex flex-col w-64">
          <SidebarContent currentPath={location.pathname} />
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-col w-0 flex-1 overflow-hidden">
        {/* Top nav */}
        <div className="md:hidden pl-1 pt-1 sm:pl-3 sm:pt-3">
          <button
            type="button"
            className="-ml-0.5 -mt-0.5 h-12 w-12 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
            onClick={() => setSidebarOpen(true)}
          >
            <span className="sr-only">Open sidebar</span>
            <Menu className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {/* Page content */}
        <main className="flex-1 relative z-0 overflow-y-auto focus:outline-none p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ currentPath }: { currentPath: string }) {
  // Get annotation counts for badges
  const { sequenceCount, detectionCount, groupCount } = useAnnotationCounts();

  // Create dynamic navigation with badge counts
  const navigationWithBadges: NavigationItem[] = [
    {
      name: 'Classify',
      children: [
        {
          name: 'Groups',
          href: '/sequence-groups',
          badgeCount: groupCount,
          badgeTitle: `${groupCount} groups need validation`,
        },
        { name: 'Sequences', href: '/sequences/annotate', badgeCount: sequenceCount },
        { name: 'Done', href: '/sequences/review' },
      ],
    },
    {
      name: 'Localize',
      children: [
        { name: 'Smoke', href: '/detections/annotate', badgeCount: detectionCount },
        { name: 'Done', href: '/detections/review' },
      ],
    },
  ];

  const isPathActive = (href?: string) => {
    if (!href || href === '#') return false;

    // Handle detection pages directly
    if (currentPath.startsWith('/detections/')) {
      // Handle nested detection routes like /detections/{id}/annotate
      if (href === '/detections/annotate' && currentPath.match(/^\/detections\/\d+\/annotate$/)) {
        const searchParams = new URLSearchParams(location.search);
        const fromParam = searchParams.get('from');
        // Only highlight Detections > Annotate if not coming from detections-review
        return fromParam !== 'detections-review';
      }
      if (href === '/detections/review' && currentPath.match(/^\/detections\/\d+\/annotate$/)) {
        const searchParams = new URLSearchParams(location.search);
        const fromParam = searchParams.get('from');
        // Highlight Detections > Review when coming from detections-review
        return fromParam === 'detections-review';
      }
      if (href === '/detections/review' && currentPath.match(/^\/detections\/\d+\/review$/)) {
        return true;
      }
      return currentPath === href;
    }

    // Special handling for sequence annotation pages to respect source context
    if (currentPath.includes('/sequences/') && currentPath.includes('/annotate')) {
      const searchParams = new URLSearchParams(window.location.search);
      const fromParam = searchParams.get('from');

      if (fromParam === 'review' && href === '/sequences/review') return true;
      if (fromParam === 'detections' && href === '/detections/annotate') return true;
      if (fromParam === 'detections-review' && href === '/detections/review') return true;
      if (!fromParam && href === '/sequences/annotate') return true;
      return false;
    }

    return currentPath === href || currentPath.startsWith(href + '/');
  };

  return (
    <div className="flex flex-col h-0 flex-1 border-r border-gray-200 bg-white">
      <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
        <div className="flex items-center flex-shrink-0 px-4">
          <Link to="/" className="flex items-center rounded-md hover:opacity-80 transition-opacity">
            <img src={logoImg} alt="PyroAnnotator Logo" className="w-8 h-8" />
            <h1 className="ml-2 text-xl font-bold text-gray-900">PyroAnnotator</h1>
          </Link>
        </div>
        <nav className="mt-8 flex-1 bg-white space-y-6">
          {navigationWithBadges.map(item => {
            return (
              <div key={item.name}>
                <div className="px-4 font-data text-[10.5px] font-medium uppercase tracking-[0.14em] text-haze">
                  {item.name}
                </div>
                <div className="mt-1">
                  {item.children.map(subItem => {
                    const isSubActive = isPathActive(subItem.href);
                    const isDisabled = subItem.href === '#';
                    return (
                      <Link
                        key={subItem.name}
                        to={isDisabled ? '#' : subItem.href}
                        onClick={e => isDisabled && e.preventDefault()}
                        className={clsx(
                          isSubActive
                            ? 'border-pine bg-pine-soft text-pine'
                            : isDisabled
                              ? 'border-transparent text-gray-400 cursor-not-allowed'
                              : 'border-transparent text-haze hover:bg-ash hover:text-char',
                          'group flex items-center justify-between border-l-[3px] pl-4 pr-2 py-2 font-body text-[13px] font-medium transition-colors'
                        )}
                      >
                        <span>{subItem.name}</span>
                        {subItem.badgeCount !== undefined && (
                          <NotificationBadge
                            count={subItem.badgeCount}
                            title={subItem.badgeTitle}
                          />
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </div>
      <div className="flex-shrink-0 border-t border-gray-200 p-4">
        <UserSection />
      </div>
    </div>
  );
}

function UserSection() {
  const { user, logout, isSuperuser } = useAuthStore();
  const [showDropdown, setShowDropdown] = useState(false);

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
  };

  const username = user?.username || 'User';

  return (
    <div className="relative">
      <div className="flex items-center p-2">
        <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
          <User className="h-4 w-4 text-white" />
        </div>
        <div className="ml-3 flex-1">
          <p className="text-sm font-medium text-gray-700">{username}</p>
          <p className="text-xs font-medium text-gray-500">Annotator</p>
        </div>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="p-2 rounded-md text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          <span className="sr-only">Open user menu</span>
          <MoreVertical className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {showDropdown && (
        <div className="absolute bottom-full right-0 mb-1 w-full bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5">
          {isSuperuser() && (
            <Link
              to="/users"
              onClick={() => setShowDropdown(false)}
              className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
            >
              <Users className="h-4 w-4 mr-2" />
              User Management
            </Link>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
