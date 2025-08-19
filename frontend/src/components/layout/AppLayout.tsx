import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, BarChart3, ChevronRight, ChevronDown, Layers, Target } from 'lucide-react';
import { clsx } from 'clsx';
import { useAnnotationCounts } from '@/hooks/useAnnotationCounts';
import NotificationBadge from '@/components/ui/NotificationBadge';

interface AppLayoutProps {
  children: React.ReactNode;
}

interface NavigationItem {
  name: string;
  href?: string;
  icon: any;
  children?: NavigationSubItem[];
}

interface NavigationSubItem {
  name: string;
  href: string;
  badgeCount?: number;
}

// Navigation structure is now dynamically generated in SidebarContent to include badge counts

export default function AppLayout({ children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50">
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
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    'Sequences': true,
    'Detections': true,
  });

  // Get annotation counts for badges
  const { sequenceCount, detectionCount } = useAnnotationCounts();

  // Create dynamic navigation with badge counts
  const navigationWithBadges: NavigationItem[] = [
    { name: 'Dashboard', href: '/', icon: BarChart3 },
    { 
      name: 'Sequences', 
      icon: Layers,
      children: [
        { name: 'Annotate', href: '/sequences/annotate', badgeCount: sequenceCount },
        { name: 'Review', href: '/sequences/review' },
      ]
    },
    { 
      name: 'Detections', 
      icon: Target,
      children: [
        { name: 'Annotate', href: '/detections/annotate', badgeCount: detectionCount },
        { name: 'Review', href: '/detections/review' },
      ]
    },
  ];

  const toggleSection = (sectionName: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionName]: !prev[sectionName]
    }));
  };

  const isPathActive = (href?: string) => {
    if (!href || href === '#') return false;
    
    // Handle detection pages directly
    if (currentPath.startsWith('/detections/')) {
      // Handle nested detection routes like /detections/{id}/annotate
      if (href === '/detections/annotate' && currentPath.match(/^\/detections\/\d+\/annotate$/)) {
        const searchParams = new URLSearchParams(window.location.search);
        const fromParam = searchParams.get('from');
        // Only highlight Detections > Annotate if not coming from detections-review
        return fromParam !== 'detections-review';
      }
      if (href === '/detections/review' && currentPath.match(/^\/detections\/\d+\/annotate$/)) {
        const searchParams = new URLSearchParams(window.location.search);
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

  const isSectionActive = (item: NavigationItem) => {
    if (item.href) {
      return isPathActive(item.href);
    }
    if (item.children) {
      return item.children.some(child => isPathActive(child.href));
    }
    return false;
  };

  return (
    <div className="flex flex-col h-0 flex-1 border-r border-gray-200 bg-white">
      <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
        <div className="flex items-center flex-shrink-0 px-4">
          <div className="flex items-center">
            <img src="/logo.png" alt="PyroAnnotator Logo" className="w-8 h-8" />
            <h1 className="ml-2 text-xl font-bold text-gray-900">
              PyroAnnotator
            </h1>
          </div>
        </div>
        <nav className="mt-8 flex-1 px-2 bg-white space-y-1">
          {navigationWithBadges.map((item) => {
            const isActive = isSectionActive(item);
            const isExpanded = expandedSections[item.name];

            if (item.href) {
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={clsx(
                    isActive
                      ? 'bg-primary-50 border-r-4 border-primary-600 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                    'group flex items-center px-2 py-2 text-sm font-medium rounded-l-md'
                  )}
                >
                  <item.icon
                    className={clsx(
                      isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500',
                      'mr-3 flex-shrink-0 h-5 w-5'
                    )}
                    aria-hidden="true"
                  />
                  {item.name}
                </Link>
              );
            }

            return (
              <div key={item.name}>
                <button
                  onClick={() => toggleSection(item.name)}
                  className={clsx(
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                    'group flex items-center px-2 py-2 text-sm font-medium rounded-l-md w-full'
                  )}
                >
                  <item.icon
                    className={clsx(
                      isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500',
                      'mr-3 flex-shrink-0 h-5 w-5'
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-left">{item.name}</span>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  )}
                </button>
                {isExpanded && item.children && (
                  <div className="mt-1 space-y-1">
                    {item.children.map((subItem) => {
                      const isSubActive = isPathActive(subItem.href);
                      const isDisabled = subItem.href === '#';
                      return (
                        <Link
                          key={subItem.name}
                          to={isDisabled ? '#' : subItem.href}
                          onClick={(e) => isDisabled && e.preventDefault()}
                          className={clsx(
                            isSubActive
                              ? 'bg-primary-50 border-r-4 border-primary-600 text-primary-700'
                              : isDisabled
                              ? 'text-gray-400 cursor-not-allowed'
                              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                            'group flex items-center justify-between pl-11 pr-2 py-2 text-sm font-medium rounded-l-md'
                          )}
                        >
                          <span>{subItem.name}</span>
                          {subItem.badgeCount !== undefined && (
                            <NotificationBadge count={subItem.badgeCount} />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
      <div className="flex-shrink-0 flex border-t border-gray-200 p-4">
        <div className="flex items-center">
          <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
            <span className="text-sm font-medium text-gray-700">U</span>
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium text-gray-700">User</p>
            <p className="text-xs font-medium text-gray-500">Annotator</p>
          </div>
        </div>
      </div>
    </div>
  );
}