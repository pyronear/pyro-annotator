import { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { ROUTES } from '@/utils/routes';

/**
 * Route guard for the Localize section. Classify-only users (no
 * can_localize grant, not superuser) are redirected to the classify queue.
 */
export default function RequireLocalize({ children }: { children: ReactElement }) {
  const { canLocalize } = useAuthStore();

  return canLocalize() ? children : <Navigate to={ROUTES.CLASSIFY} replace />;
}
