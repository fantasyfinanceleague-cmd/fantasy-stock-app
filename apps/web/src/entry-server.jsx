// src/entry-server.jsx
/* eslint-disable react-refresh/only-export-components -- build-time SSR entry,
   never hot-reloaded; it exports render() plus the data the prerender needs. */
// Build-time prerender entry for the paused landing page (built with
// `vite build --ssr`, run by scripts/prerender-landing.mjs). It renders the
// SAME tree main.jsx hydrates — StrictMode › ErrorBoundary › router › App at
// "/" — so the server markup and the client's first render match exactly
// (a StaticRouter stands in for BrowserRouter; neither adds DOM).
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { APP_PAUSED } from './appPaused';
import { landingHead } from './pages/landing/head';

export { APP_PAUSED, landingHead };

export function render() {
  return renderToString(
    <StrictMode>
      <ErrorBoundary>
        <StaticRouter location="/">
          <App />
        </StaticRouter>
      </ErrorBoundary>
    </StrictMode>
  );
}
