// src/components/ErrorBoundary.jsx
import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App error:', error);
    console.error('Error info:', errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleRefresh = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b1220',
          padding: 20,
        }}>
          <div style={{
            background: '#111827',
            borderRadius: 12,
            padding: 32,
            maxWidth: 500,
            width: '100%',
            textAlign: 'center',
            border: '1px solid #1f2937',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h1 style={{ color: '#fff', margin: '0 0 12px', fontSize: 24 }}>
              Something went wrong
            </h1>
            <p style={{ color: '#9ca3af', margin: '0 0 24px', fontSize: 15 }}>
              An unexpected error occurred. Please try refreshing the page or go back to the dashboard.
            </p>

            {this.state.error && (
              <div style={{
                background: '#1f2937',
                borderRadius: 8,
                padding: 12,
                marginBottom: 24,
                textAlign: 'left',
              }}>
                <div style={{ color: '#ef4444', fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-word' }}>
                  {this.state.error.toString()}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={this.handleRefresh}
                style={{
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Refresh Page
              </button>
              <button
                onClick={this.handleGoHome}
                style={{
                  background: '#374151',
                  color: '#fff',
                  border: '1px solid #4b5563',
                  borderRadius: 8,
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
