import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import HomePage from '@/pages/HomePage';
import DashboardPage from '@/pages/DashboardPage';
import SequencesPage from '@/pages/SequencesPage';
import SequencesPageWrapper from '@/pages/SequencesPageWrapper';
import AnnotationInterface from '@/pages/AnnotationInterface';
import DetectionAnnotatePage from '@/pages/DetectionAnnotatePage';
import DetectionReviewPage from '@/pages/DetectionReviewPage';

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
                <Route path="/sequences/annotate" element={<SequencesPage />} />
                <Route path="/sequences/review" element={<SequencesPageWrapper defaultProcessingStage="annotated" />} />
                <Route path="/sequences/:id/annotate" element={<AnnotationInterface />} />
                <Route path="/detections/annotate" element={<DetectionAnnotatePage />} />
                <Route path="/detections/review" element={<DetectionReviewPage />} />
              </Routes>
            </AppLayout>
          } />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}

export default App;