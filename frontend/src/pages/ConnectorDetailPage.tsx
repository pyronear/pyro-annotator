import { useParams } from 'react-router-dom';

import { useConnectors } from '@/hooks/useConnectors';

// Minimal stub so the /connectors/:connectorId route resolves. Task 12
// replaces this entirely with the real detail page (organizations, verify,
// coverage heatmap).
export default function ConnectorDetailPage() {
  const { connectorId } = useParams();
  const { data } = useConnectors();
  const connector = data?.find(c => c.id === Number(connectorId));
  return <div className="p-6">{connector?.name ?? 'Connector'}</div>;
}
