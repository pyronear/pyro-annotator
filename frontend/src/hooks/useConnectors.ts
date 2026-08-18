import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import type {
  Connector,
  ConnectorCreatePayload,
  ConnectorOrganization,
  ConnectorTestPayload,
  ConnectorTestResult,
  ConnectorUpdatePayload,
  CoverageCell,
  VerifyResult,
} from '@/types/api';

export function useConnectors() {
  return useQuery<Connector[]>({
    queryKey: QUERY_KEYS.CONNECTORS,
    queryFn: () => apiClient.getConnectors(),
  });
}

export function useCreateConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConnectorCreatePayload) => apiClient.createConnector(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CONNECTORS }),
  });
}

export function useTestConnector() {
  return useMutation<ConnectorTestResult, Error, ConnectorTestPayload>({
    mutationFn: payload => apiClient.testConnector(payload),
  });
}

export function useUpdateConnector(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConnectorUpdatePayload) => apiClient.updateConnector(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CONNECTORS }),
  });
}

export function useDeleteConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiClient.deleteConnector(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CONNECTORS }),
  });
}

export function useConnectorOrganizations(id: number) {
  return useQuery<ConnectorOrganization[]>({
    queryKey: QUERY_KEYS.CONNECTOR_ORGANIZATIONS(id),
    queryFn: () => apiClient.getConnectorOrganizations(id),
    enabled: Number.isFinite(id),
  });
}

export function useVerifyConnector(id: number) {
  const queryClient = useQueryClient();
  return useMutation<VerifyResult, Error, void>({
    mutationFn: () => apiClient.verifyConnector(id),
    onSuccess: () => {
      // Verify both discovers organizations and stamps last_verified_at.
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.CONNECTOR_ORGANIZATIONS(id),
      });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CONNECTORS });
    },
  });
}

export function useToggleConnectorOrganization(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ organizationId, isEnabled }: { organizationId: number; isEnabled: boolean }) =>
      apiClient.toggleConnectorOrganization(id, organizationId, isEnabled),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.CONNECTOR_ORGANIZATIONS(id),
      });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CONNECTORS });
    },
  });
}

export function useConnectorCoverage(id: number, dateFrom: string, dateEnd: string) {
  return useQuery<CoverageCell[]>({
    queryKey: QUERY_KEYS.CONNECTOR_COVERAGE(id, dateFrom, dateEnd),
    queryFn: () => apiClient.getConnectorCoverage(id, dateFrom, dateEnd),
    enabled: Number.isFinite(id) && Boolean(dateFrom) && Boolean(dateEnd),
  });
}
