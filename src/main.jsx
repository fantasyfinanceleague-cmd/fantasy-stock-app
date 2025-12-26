// main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { PriceProvider } from './context/PriceContext';
import { UserProfilesProvider } from './context/UserProfilesContext';
import { ToastProvider } from './components/Toast';
import { HelpProvider } from './context/HelpContext';
import HelpWalkthrough from './components/HelpWalkthrough';
import './layout.css'; // for your custom grid
import './index.css';  // includes Tailwind (if you're using it at all)


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <UserProfilesProvider>
            <PriceProvider>
              <HelpProvider>
                <App />
                <HelpWalkthrough />
              </HelpProvider>
            </PriceProvider>
          </UserProfilesProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
