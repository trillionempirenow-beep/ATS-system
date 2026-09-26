import { createBrowserRouter, Outlet } from 'react-router-dom';
import { page } from './lazyPage';
import { AuthLayout } from './layouts/AuthLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { AppShell } from './layouts/AppShell';
import { RequireAuth } from './guards';
import { NotFoundPage, RouteErrorPage } from './system/StatusPages';
import { SessionGate } from './SessionGate';
import { appRoutes } from './routes.app';

export const router = createBrowserRouter([
  {
    element: <SessionGate><Outlet /></SessionGate>,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <PublicLayout />,
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: page(() => import('@/features/careers/HomePage'), 'HomePage') },
          { path: 'jobs', element: page(() => import('@/features/careers/RolesPage'), 'RolesPage') },
          { path: 'jobs/:slug', element: page(() => import('@/features/careers/JobDetailPage'), 'JobDetailPage') },
          { path: 'jobs/:slug/apply', element: page(() => import('@/features/careers/ApplyPage'), 'ApplyPage') },
          { path: 'status', element: page(() => import('@/features/careers/StatusPage'), 'StatusPage') },
          { path: 'refer', element: page(() => import('@/features/careers/ReferPage'), 'ReferPage') },
          { path: 'interview/:code', element: page(() => import('@/features/room/CandidateRoomPage'), 'CandidateRoomPage') },
        ],
      },
      {
        element: <AuthLayout />,
        children: [
          { path: 'login', element: page(() => import('@/features/auth/LoginPage'), 'LoginPage') },
          { path: 'forgot-password', element: page(() => import('@/features/auth/PasswordPages'), 'ForgotPasswordPage') },
          { path: 'reset-password/:token', element: page(() => import('@/features/auth/PasswordPages'), 'ResetPasswordPage') },
        ],
      },
      {
        path: 'app',
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            errorElement: <RouteErrorPage />,
            children: [...appRoutes, { path: '*', element: <NotFoundPage /> }],
          },
        ],
      },
      { path: '*', element: <PublicLayout />, children: [{ path: '*', element: <NotFoundPage /> }] },
    ],
  },
]);
