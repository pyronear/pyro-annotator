import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu } from '@headlessui/react';
import { Menu as MenuIcon, MoreVertical, X, LogOut, User, Users, Plug } from 'lucide-react';
import { clsx } from 'clsx';
import { useAnnotationCounts } from '@/hooks/useAnnotationCounts';
import NotificationBadge from '@/components/ui/NotificationBadge';
import { useAuthStore } from '@/store/useAuthStore';
import { ROUTES } from '@/utils/routes';
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
            <MenuIcon className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {/* Page content. Padding lives on an inner wrapper, not the scroll
            container itself: scroll-container padding pins sticky children
            below it (it never scrolls away), which would break sticky
            page headers. */}
        <main className="flex-1 relative z-0 overflow-y-auto focus:outline-none">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ currentPath }: { currentPath: string }) {
  // Get annotation counts for badges
  const { sequenceCount, detectionCount, groupCount } = useAnnotationCounts();
  const { canLocalize } = useAuthStore();

  // Create dynamic navigation with badge counts
  const navigationWithBadges: NavigationItem[] = [
    {
      name: 'Classify',
      children: [
        {
          name: 'Recurring objects',
          href: ROUTES.CLASSIFY_GROUPS,
          badgeCount: groupCount,
          badgeTitle: `${groupCount} recurring objects need validation`,
        },
        { name: 'Alerts', href: ROUTES.CLASSIFY, badgeCount: sequenceCount },
        { name: 'Done', href: ROUTES.CLASSIFY_DONE },
      ],
    },
    ...(canLocalize()
      ? [
          {
            name: 'Localize',
            children: [
              { name: 'Smoke', href: ROUTES.LOCALIZE, badgeCount: detectionCount },
              { name: 'Done', href: ROUTES.LOCALIZE_DONE },
            ],
          },
        ]
      : []),
  ];

  const isPathActive = (href: string) => {
    if (currentPath === href) return true;
    // Bare pass roots own their detail pages, except the done/groups subtrees.
    if (href === ROUTES.CLASSIFY) {
      return (
        currentPath.startsWith('/classify/') &&
        !currentPath.startsWith(ROUTES.CLASSIFY_DONE) &&
        !currentPath.startsWith(ROUTES.CLASSIFY_GROUPS)
      );
    }
    if (href === ROUTES.LOCALIZE) {
      return currentPath.startsWith('/localize/') && !currentPath.startsWith(ROUTES.LOCALIZE_DONE);
    }
    return currentPath.startsWith(href + '/');
  };

  return (
    <div className="flex flex-col h-0 flex-1 border-r border-gray-200 bg-white">
      <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
        <div className="flex items-center flex-shrink-0 px-4">
          <Link
            to="/"
            className="flex items-center rounded-md -mx-2 px-2 py-1.5 hover:bg-ash transition-colors"
            title="Go to dashboard"
          >
            <img src={logoImg} alt="PyroAnnotator Logo" className="w-8 h-8" />
            <h1 className="ml-2 text-xl font-bold text-gray-900">PyroAnnotator</h1>
          </Link>
        </div>
        <nav className="mt-8 flex-1 bg-white space-y-6">
          {navigationWithBadges.map(item => {
            return (
              <div key={item.name}>
                <div className="px-4 font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  {item.name}
                </div>
                <div className="mt-1">
                  {item.children.map(subItem => {
                    const isSubActive = isPathActive(subItem.href);
                    return (
                      <Link
                        key={subItem.name}
                        to={subItem.href}
                        className={clsx(
                          isSubActive
                            ? 'border-pine bg-pine-soft text-pine'
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

  const username = user?.username || 'User';

  return (
    <Menu as="div" className="relative">
      <div className="flex items-center p-2">
        <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
          <User className="h-4 w-4 text-white" />
        </div>
        <div className="ml-3 flex-1">
          <p className="text-sm font-medium text-gray-700">{username}</p>
          <p className="text-xs font-medium text-gray-500">Annotator</p>
        </div>
        <Menu.Button className="p-2 rounded-md text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors">
          <span className="sr-only">Open user menu</span>
          <MoreVertical className="h-5 w-5" aria-hidden="true" />
        </Menu.Button>
      </div>

      <Menu.Items className="absolute bottom-full right-0 mb-1 w-full rounded-md border border-line bg-paper focus:outline-none">
        {isSuperuser() && (
          <Menu.Item>
            {({ active }) => (
              <Link
                to="/users"
                className={clsx(
                  active && 'bg-ash',
                  'flex items-center w-full px-4 py-2 text-sm text-char rounded-md'
                )}
              >
                <Users className="h-4 w-4 mr-2" />
                User Management
              </Link>
            )}
          </Menu.Item>
        )}
        {isSuperuser() && (
          <Menu.Item>
            {({ active }) => (
              <Link
                to="/connectors"
                className={clsx(
                  active && 'bg-ash',
                  'flex items-center w-full px-4 py-2 text-sm text-char rounded-md'
                )}
              >
                <Plug className="h-4 w-4 mr-2" />
                Connectors
              </Link>
            )}
          </Menu.Item>
        )}
        <Menu.Item>
          {({ active }) => (
            <button
              onClick={logout}
              className={clsx(
                active && 'bg-ash',
                'flex items-center w-full px-4 py-2 text-sm text-char rounded-md'
              )}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </button>
          )}
        </Menu.Item>
      </Menu.Items>
    </Menu>
  );
}
