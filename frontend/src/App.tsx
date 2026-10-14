import { useEffect, type ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { Workspace } from './layout/Workspace';
import { refreshSession } from './lib/api';
import { useT } from './lib/i18n';
import { Empty, Spinner } from './components/ui';
import { applyTheme, usePrefsStore } from './store/prefs';
import { useAuthStore } from './store/auth';
import { installHistoryShortcuts, installUnloadFlush } from './store/project';
import {
  CheckEmailPage, ForgotPasswordPage, LegalPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage,
} from './pages/public/AuthPages';
import { LandingPage } from './pages/public/LandingPage';
import {
  ComingSoonPage, DashboardPage, ProjectsPage, RenderQueuePage, SettingsPage, StudioGatePage,
} from './pages/AppPages';
import {
  AdminAI, AdminBilling, AdminDashboard, AdminLayout, AdminPayments, AdminSecurity,
  AdminSettings, AdminSystem, AdminUserDetail, AdminUsers,
} from './pages/admin/AdminPages';

function RequireAuth({ children }: { children: ReactElement }) {
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  if (!isInitialized) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function RequireAdmin({ children }: { children: ReactElement }) {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'admin') {
    return <div className="p-8"><Empty>403 · {t('admin.title')}</Empty></div>;
  }
  return children;
}

function NotFound() {
  return <div className="p-8"><Empty>404</Empty></div>;
}

export default function App(): ReactElement {
  const theme = usePrefsStore((s) => s.theme);

  const lang = usePrefsStore((s) => s.lang);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    let alive = true;
    void refreshSession().finally(() => {
      if (alive) useAuthStore.getState().setReady();
    });
    const stopShortcuts = installHistoryShortcuts();
    const stopFlush = installUnloadFlush();
    return () => {
      alive = false;
      stopShortcuts();
      stopFlush();
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/check-email" element={<CheckEmailPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/terms" element={<LegalPage kind="terms" />} />
        <Route path="/privacy" element={<LegalPage kind="privacy" />} />

        <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId/:studio" element={<Workspace />} />
          <Route path="studio/:studioId" element={<StudioGateRoute />} />
          <Route path="create-ai" element={<ComingSoonPage titleKey="nav.create_ai" />} />
          <Route path="asset-library" element={<ComingSoonPage titleKey="nav.asset_library" />} />
          <Route path="render-queue" element={<RenderQueuePage />} />
          <Route path="team" element={<ComingSoonPage titleKey="nav.team" />} />
          <Route path="marketplace" element={<ComingSoonPage titleKey="nav.marketplace" />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="users/:userId" element={<AdminUserDetail />} />
            <Route path="ai" element={<AdminAI />} />
            <Route path="billing" element={<AdminBilling />} />
            <Route path="payments" element={<AdminPayments />} />
            <Route path="system" element={<AdminSystem />} />
            <Route path="security" element={<AdminSecurity />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="/" element={<HomeRoute />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Guests see the landing page; signed-in users go straight to the dashboard. */
function HomeRoute() {
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const user = useAuthStore((s) => s.user);
  if (!isInitialized) return <Spinner />;
  if (user) return <Navigate to="/app/dashboard" replace />;
  return <LandingPage />;
}

function StudioGateRoute() {
  const studioId = useLocation().pathname.split('/').pop() ?? '';
  return <StudioGatePage studioId={studioId} />;
}
