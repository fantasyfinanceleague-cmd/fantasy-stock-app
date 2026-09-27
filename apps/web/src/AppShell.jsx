// src/AppShell.jsx
// The full (unpaused) app: every app route, the app-wide providers, and the
// legacy app CSS. App.jsx lazy-loads this module ONLY when APP_PAUSED is
// false, so none of it — layout.css/index.css, PriceProvider's quote fetches,
// SessionMonitor, Supabase — reaches the landing page's bundle
// (docs/design/prompts/phase3a-landing.md, "Isolation"). While paused, the
// lazy import is dead code and Rollup drops this whole subtree from dist/.
//
// Import order mirrors the pre-split main.jsx (App's page imports first,
// then the providers, then layout.css and index.css) so the app's CSS
// cascade is unchanged.
import AppRoutes from './AppRoutes';
import { PriceProvider } from './context/PriceContext';
import { UserProfilesProvider } from './context/UserProfilesContext';
import { ToastProvider } from './components/Toast';
import { HelpProvider } from './context/HelpContext';
import HelpWalkthrough from './components/HelpWalkthrough';
import SessionMonitor from './components/SessionMonitor';
import './layout.css'; // for your custom grid
import './index.css';  // includes Tailwind (if you're using it at all)

export default function AppShell() {
  return (
    <ToastProvider>
      <SessionMonitor />
      <UserProfilesProvider>
        <PriceProvider>
          <HelpProvider>
            <AppRoutes />
            <HelpWalkthrough />
          </HelpProvider>
        </PriceProvider>
      </UserProfilesProvider>
    </ToastProvider>
  );
}
