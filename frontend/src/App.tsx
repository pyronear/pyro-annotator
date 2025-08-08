import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import HomePage from '@/pages/HomePage';
import DashboardPage from '@/pages/DashboardPage';
import SequencesPage from '@/pages/SequencesPage';
import SequencesPageWrapper from '@/pages/SequencesPageWrapper';
import AnnotationInterface from '@/pages/AnnotationInterface';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/*" element={
            <AppLayout>
              <Routes>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/sequences" element={<SequencesPage />} />
                <Route path="/sequences-review" element={<SequencesPageWrapper defaultProcessingStage="annotated" />} />
                <Route path="/sequences/:id/annotate" element={<AnnotationInterface />} />
              </Routes>
            </AppLayout>
          } />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}

export default App;