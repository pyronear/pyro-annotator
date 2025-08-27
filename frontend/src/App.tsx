import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import DashboardPage from '@/pages/DashboardPage';
import SequencesPage from '@/pages/SequencesPage';
import SequencesPageWrapper from '@/pages/SequencesPageWrapper';
import AnnotationInterface from '@/pages/AnnotationInterface';
import DetectionAnnotatePage from '@/pages/DetectionAnnotatePage';
import DetectionReviewPage from '@/pages/DetectionReviewPage';
import DetectionSequenceAnnotatePage from '@/pages/DetectionSequenceAnnotatePage';
import UserManagementPage from '@/pages/UserManagementPage';
import LoginPage from '@/pages/LoginPage';
import { useAuthStore } from '@/store/useAuthStore';

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
  const { isAuthenticated, isLoading, error, login, clearError, initializeAuth } = useAuthStore();

  useEffect(() => {
    // Initialize authentication on app start
    initializeAuth();
  }, [initializeAuth]);

  const handleLogin = async (username: string, password: string) => {
    clearError();
    await login(username, password);
  };

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return (
      <QueryClientProvider client={queryClient}>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route
              path="/login"
              element={<LoginPage onLogin={handleLogin} isLoading={isLoading} error={error} />}
            />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Router>
      </QueryClientProvider>
    );
  }

  // Show authenticated app
  return (
    <QueryClientProvider client={queryClient}>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route
            path="/"
            element={
              <AppLayout>
                <DashboardPage />
              </AppLayout>
            }
          />
          <Route
            path="/*"
            element={
              <AppLayout>
                <Routes>
                  <Route path="/sequences/annotate" element={<SequencesPage />} />
                  <Route
                    path="/sequences/review"
                    element={<SequencesPageWrapper defaultProcessingStage="annotated" />}
                  />
                  <Route path="/sequences/:id/annotate" element={<AnnotationInterface />} />
                  <Route path="/detections/annotate" element={<DetectionAnnotatePage />} />
                  <Route path="/detections/review" element={<DetectionReviewPage />} />
                  <Route
                    path="/detections/:sequenceId/annotate/:detectionId?"
                    element={<DetectionSequenceAnnotatePage />}
                  />
                  <Route path="/users" element={<UserManagementPage />} />
                </Routes>
              </AppLayout>
            }
          />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
