import type { RightStatus, UserRole } from '@/types/api';

export const USER_ROLES: UserRole[] = ['annotator', 'annotation_manager', 'admin'];
export const RIGHT_STATUSES: RightStatus[] = ['locked', 'training', 'granted'];

export const ROLE_LABELS: Record<UserRole, string> = {
  annotator: 'Annotator',
  annotation_manager: 'Annotation manager',
  admin: 'Admin',
};

export const RIGHT_STATUS_LABELS: Record<RightStatus, string> = {
  locked: 'Locked',
  training: 'In training',
  granted: 'Granted',
};
