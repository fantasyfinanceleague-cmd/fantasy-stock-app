// src/App.jsx
import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LandingPage from "./pages/landing/LandingPage";
import { APP_PAUSED } from "./appPaused";

// ── Route-level isolation (docs/design/prompts/phase3a-landing.md) ─────────
// The landing is the only statically imported page. Everything else — the
// app routes, the app-wide providers (PriceProvider fetches quotes on mount)
// and the legacy app CSS (layout.css / index.css) — lives in AppShell.jsx,
// loaded lazily and only when APP_PAUSED is false. While paused the lazy
// import below is unreachable, so Rollup drops the whole app subtree and the
// landing bundle carries none of it. APP_PAUSED itself lives in appPaused.js
// (see that file for what the flag does and does not protect).
//
// The ternary matters: a bare top-level `lazy(() => import(...))` is a call
// Rollup must keep (it can't prove `lazy` pure), which would still emit the
// whole app as an unused chunk. Folding on the constant drops it outright.
const AppShell = APP_PAUSED ? null : lazy(() => import("./AppShell"));

// ── Design gallery (dev-only, Phase 2 foundation) ──────────────────────────
// docs/design/prompts/phase2-foundation-web.md: "a /design route that
// exists ONLY in development ... outside the APP_PAUSED branch, so it works
// while the app is paused." `import.meta.env.DEV` is a build-time constant
// Vite inlines as a literal `false` in a production build, so the ternary
// folds to `null` and Rollup drops the dead `lazy(() => import(...))` branch
// (and everything design/gallery/DesignGallery.tsx pulls in) from the
// shipped bundle entirely.
//
// Read via `window.location.pathname`, not react-router's `useLocation()`:
// this must not add a router hook to the code path APP_PAUSED takes, since
// that path renders its own separate <Routes> tree below.
const DesignGallery = import.meta.env.DEV ? lazy(() => import("./design/gallery/DesignGallery")) : null;

function App() {
  // typeof guard: this runs during the build-time prerender too (renderToString
  // in Node, no window). Only a development SSR build ever reaches it.
  if (DesignGallery && typeof window !== "undefined" && window.location.pathname === "/design") {
    return (
      <Suspense fallback={null}>
        <DesignGallery />
      </Suspense>
    );
  }

  // Paused: serve only the landing page; send every other path back to it.
  if (APP_PAUSED) {
    return (
      <Routes>
        {/* Render the landing page directly (not via Home, which would
            redirect a logged-in session into the dashboard). */}
        <Route path="/" element={<LandingPage />} />
        {/* Any other URL (/login, /signup, /dashboard, app routes, …) → landing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Suspense fallback={null}>
      <AppShell />
    </Suspense>
  );
}

export default App;
