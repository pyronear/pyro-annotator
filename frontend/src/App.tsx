import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import DashboardPage from '@/pages/DashboardPage';
import SequencesPage from '@/pages/SequencesPage';
import SequencesPageWrapper from '@/pages/SequencesPageWrapper';
import ClassifyAlertPage from '@/pages/ClassifyAlertPage';
import DetectionAnnotatePage from '@/pages/DetectionAnnotatePage';
import DetectionReviewPage from '@/pages/DetectionReviewPage';
import LocalizeAlertPage from '@/pages/LocalizeAlertPage';
import SequenceGroupAnnotatePage from '@/pages/SequenceGroupAnnotatePage';
import SequenceGroupsListPage from '@/pages/SequenceGroupsListPage';
import UserManagementPage from '@/pages/UserManagementPage';
import GuidePage from '@/pages/GuidePage';
import LoginPage from '@/pages/LoginPage';
import { legacyRedirectRoutes } from '@/components/routing/legacyRedirects';
import RequireLocalize from '@/components/routing/RequireLocalize';
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
                  <Route path="/classify" element={<SequencesPage />} />
                  <Route
                    path="/classify/done"
                    element={<SequencesPageWrapper defaultProcessingStage="annotated" />}
                  />
                  <Route path="/classify/groups" element={<SequenceGroupsListPage />} />
                  <Route
                    path="/classify/groups/labeled"
                    element={<SequenceGroupsListPage filter="labeled" />}
                  />
                  <Route
                    path="/classify/groups/all"
                    element={<SequenceGroupsListPage filter="all" />}
                  />
                  <Route path="/classify/groups/:id" element={<SequenceGroupAnnotatePage />} />
                  <Route path="/classify/done/:id" element={<ClassifyAlertPage mode="done" />} />
                  <Route path="/classify/:id" element={<ClassifyAlertPage />} />
                  <Route
                    path="/localize"
                    element={
                      <RequireLocalize>
                        <DetectionAnnotatePage />
                      </RequireLocalize>
                    }
                  />
                  <Route
                    path="/localize/done"
                    element={
                      <RequireLocalize>
                        <DetectionReviewPage />
                      </RequireLocalize>
                    }
                  />
                  {/* Same component either side, provenance from the path —
                      the /localize/done route must precede the dynamic
                      /localize/:sequenceId below so "done" isn't swallowed
                      as a sequence id. */}
                  <Route
                    path="/localize/done/:sequenceId/:detectionId?"
                    element={
                      <RequireLocalize>
                        <LocalizeAlertPage mode="done" />
                      </RequireLocalize>
                    }
                  />
                  <Route
                    path="/localize/:sequenceId/:detectionId?"
                    element={
                      <RequireLocalize>
                        <LocalizeAlertPage />
                      </RequireLocalize>
                    }
                  />
                  {legacyRedirectRoutes}
                  <Route path="/users" element={<UserManagementPage />} />
                  <Route path="/guide" element={<GuidePage />} />
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
