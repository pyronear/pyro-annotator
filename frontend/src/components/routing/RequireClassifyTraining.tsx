import { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { ROUTES, isGuidePath } from '@/utils/routes';

/**
 * App-wide gate: a user who cannot classify yet (classify right not granted,
 * not admin) only has the user guide. Every other path, the home page
 * included, sends to /guide. See
 * docs/specs/2026-11-26-guide-training-access-design.md.
 */
export default function RequireClassifyTraining({ children }: { children: ReactElement }) {
  const { canClassify } = useAuthStore();
  const { pathname } = useLocation();

  if (!canClassify() && !isGuidePath(pathname)) {
    return <Navigate to={ROUTES.GUIDE} replace />;
  }
  return children;
}
