import { ThemeProvider } from "@staffbase/design";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { ToastProvider } from "./components/studio/ToastProvider.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import { SessionProvider } from "./context/SessionContext.tsx";
import AdminView from "./pages/AdminView.tsx";
import DevView from "./pages/DevView.tsx";
import EndUserView from "./pages/EndUserView.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider presetName="studioDefault">
          <ToastProvider />
          <SessionProvider>
            <AuthProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<EndUserView />} />
                  <Route path="/admin" element={<AdminView />} />
                  <Route path="/dev" element={<DevView />} />
                </Routes>
              </BrowserRouter>
            </AuthProvider>
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
