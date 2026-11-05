import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom';
import { ChangePasswordPage, HomeRedirect, LoginPage, NavigationBridge, RequireAuth, STAFF, STUDENT } from './auth';
import { isValidSlug, parseId } from './api/client';
import Layout from './layout/Layout';
import Dashboard from './pages/student/Dashboard';
import History from './pages/student/History';
import ProblemPage from './pages/student/ProblemPage';
import ReportPage from './pages/student/ReportPage';
import NotFoundPage from './pages/system/NotFoundPage';
import { staffRoutes } from './pages/staff';

/** Malformed ids and slugs show NotFound instead of fetching (and spinning) forever. */
function ValidId({ children, back, backLabel }: { children: JSX.Element; back: string; backLabel: string }) {
  const { id } = useParams();
  return parseId(id) ? children : <NotFoundPage what={`Submission "${id}"`} backTo={back} backLabel={backLabel} />;
}

function ValidSlug({ children }: { children: JSX.Element }) {
  const { slug } = useParams();
  return isValidSlug(slug) ? children : <NotFoundPage what={`The problem "${slug}"`} backTo="/dashboard" backLabel="Back to problems" />;
}

export default function App() {
  return (
    <BrowserRouter>
      <NavigationBridge />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/change-password"
          element={
            <RequireAuth>
              <ChangePasswordPage />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route
            path="submissions/:id"
            element={
              <ValidId back="/history" backLabel="Back to my submissions">
                <ReportPage />
              </ValidId>
            }
          />
          <Route
            path="dashboard"
            element={
              <RequireAuth roles={STUDENT}>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="problems/:slug"
            element={
              <RequireAuth roles={STUDENT}>
                <ValidSlug>
                  <ProblemPage />
                </ValidSlug>
              </RequireAuth>
            }
          />
          <Route
            path="history"
            element={
              <RequireAuth roles={STUDENT}>
                <History />
              </RequireAuth>
            }
          />
          <Route path="staff">
            {staffRoutes.map((r) => (
              <Route
                key={r.path || 'index'}
                index={r.path === ''}
                path={r.path === '' ? undefined : r.path}
                element={
                  <RequireAuth roles={STAFF}>
                    {r.path === 'submissions/:id' ? (
                      <ValidId back="/staff/submissions" backLabel="Back to submissions">
                        <>{r.element}</>
                      </ValidId>
                    ) : (
                      r.element
                    )}
                  </RequireAuth>
                }
              />
            ))}
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
