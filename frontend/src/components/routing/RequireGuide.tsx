import { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { guideAccessForUser } from '@/utils/guideAccess';
import { ROUTES } from '@/utils/routes';

/**
 * Route guard for the user guide. A user who has both rights granted no
 * longer sees the guide and is sent to the home page. With `module`, a user
 * whose right for that module is locked is sent back to the guide hub.
 */
export default function RequireGuide({
  children,
  module,
}: {
  children: ReactElement;
  module?: 'classification' | 'localization';
}) {
  const { user } = useAuthStore();
  const access = guideAccessForUser(user);

  if (!access.visible) return <Navigate to="/" replace />;
  if (module === 'classification' && access.classifyLocked) {
    return <Navigate to={ROUTES.GUIDE} replace />;
  }
  if (module === 'localization' && access.localizeLocked) {
    return <Navigate to={ROUTES.GUIDE} replace />;
  }
  return children;
}
