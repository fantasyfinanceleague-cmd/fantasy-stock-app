// main.jsx
//
// Deliberately minimal: the router, the crash guard and App — nothing else.
// The app-wide providers and the legacy app CSS moved into the lazily
// loaded AppShell.jsx so the landing page (the only public surface while
// APP_PAUSED) neither downloads them nor runs their side effects
// (docs/design/prompts/phase3a-landing.md, "Isolation").
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { APP_PAUSED } from './appPaused';

const tree = (
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);

const container = document.getElementById('root');

// While paused, `npm run build` prerenders the landing into dist/index.html
// (scripts/prerender-landing.mjs), and Vercel's SPA rewrite serves that same
// file for every path. The paused app sends every path to `/` anyway (the
// <Navigate replace> in App.jsx), so do that redirect BEFORE React starts:
// then the prerendered markup is always hydrated in place rather than
// thrown away and re-rendered.
const prerendered = container.hasChildNodes();
if (prerendered && APP_PAUSED && window.location.pathname !== '/') {
  window.history.replaceState(null, '', '/');
}

if (prerendered && window.location.pathname === '/') {
  hydrateRoot(container, tree);
} else {
  createRoot(container).render(tree);
}
