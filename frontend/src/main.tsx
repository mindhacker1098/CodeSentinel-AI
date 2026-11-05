import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@mantine/core/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import { ApiError } from './api/client';
import { AuthProvider } from './auth';
import { handleApiError } from './auth/session';
import { cssVariablesResolver, theme } from './theme/theme';
import App from './App';

const queryClient: QueryClient = new QueryClient({
  // 401 -> sign-in page with "Your session ended"; 403 "password change required" -> /change-password.
  queryCache: new QueryCache({ onError: (e, q) => handleApiError(queryClient, e, q.meta) }),
  mutationCache: new MutationCache({ onError: (e, _v, _c, m) => handleApiError(queryClient, e, m.meta) }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Client errors (4xx) are answers, not glitches: do not retry them.
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme="dark" defaultColorScheme="dark">
      <Notifications position="bottom-right" limit={4} zIndex={1000} />
      <QueryClientProvider client={queryClient}>
        <ModalsProvider labels={{ confirm: 'Confirm', cancel: 'Cancel' }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
);
