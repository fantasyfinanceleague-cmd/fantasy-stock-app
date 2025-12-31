import React from 'react';
import { Link } from 'react-router-dom';

export default function LandingPage() {
  const features = [
    {
      icon: '📈',
      title: 'Real Stock Prices',
      description: 'Draft and trade real stocks with live market data. Your portfolio performance is based on actual stock movements.',
    },
    {
      icon: '🏈',
      title: 'Fantasy Sports Style',
      description: 'Weekly head-to-head matchups, win-loss records, playoffs, and championships - just like fantasy football.',
    },
    {
      icon: '🎯',
      title: 'Snake Draft',
      description: 'Strategic draft system where pick order reverses each round. Build your perfect portfolio.',
    },
    {
      icon: '🔄',
      title: 'Trade Window',
      description: 'Make trades on Mondays to adjust your portfolio. Swap stocks to optimize your lineup.',
    },
    {
      icon: '🏆',
      title: 'Playoffs & Championships',
      description: 'Top teams make the playoffs. Single elimination bracket crowns the ultimate champion.',
    },
    {
      icon: '👥',
      title: 'Play with Friends',
      description: 'Create private leagues and invite friends. Compete to see who has the best stock-picking skills.',
    },
  ];

  const steps = [
    {
      num: '1',
      title: 'Create or Join a League',
      description: 'Start your own league and invite friends, or join an existing league with an invite link.',
    },
    {
      num: '2',
      title: 'Draft Your Stocks',
      description: 'Take turns picking stocks in a snake draft. Build a portfolio you believe in.',
    },
    {
      num: '3',
      title: 'Compete Weekly',
      description: 'Your portfolio goes head-to-head against opponents. Best performance wins the matchup.',
    },
    {
      num: '4',
      title: 'Win the Championship',
      description: 'Make the playoffs, advance through the bracket, and become the league champion.',
    },
  ];

  return (
    <div style={{ background: '#0b1120', minHeight: '100vh' }}>
      {/* Header */}
      <header style={{
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        maxWidth: 1200,
        margin: '0 auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>📊</span>
          <span style={{ color: '#fff', fontSize: 20, fontWeight: 700 }}>Stockpile</span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link
            to="/login"
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: '1px solid #374151',
              borderRadius: 8,
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 500,
              fontSize: 14,
            }}
          >
            Log In
          </Link>
          <Link
            to="/signup"
            style={{
              padding: '10px 20px',
              background: '#3b82f6',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Sign Up Free
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section style={{
        padding: '80px 24px 100px',
        textAlign: 'center',
        maxWidth: 900,
        margin: '0 auto',
      }}>
        <div style={{
          display: 'inline-block',
          padding: '8px 16px',
          background: 'rgba(59, 130, 246, 0.15)',
          borderRadius: 20,
          color: '#60a5fa',
          fontSize: 14,
          fontWeight: 500,
          marginBottom: 24,
        }}>
          Fantasy Sports Meets the Stock Market
        </div>
        <h1 style={{
          color: '#fff',
          fontSize: 'clamp(36px, 6vw, 60px)',
          fontWeight: 800,
          lineHeight: 1.1,
          margin: '0 0 24px',
        }}>
          Draft Stocks.<br />
          Beat Your Friends.<br />
          <span style={{ color: '#3b82f6' }}>Win the League.</span>
        </h1>
        <p style={{
          color: '#9ca3af',
          fontSize: 'clamp(16px, 2vw, 20px)',
          maxWidth: 600,
          margin: '0 auto 40px',
          lineHeight: 1.6,
        }}>
          Stockpile is fantasy sports for the stock market. Draft real stocks, compete in weekly matchups, and prove you're the best investor among your friends.
        </p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            to="/signup"
            style={{
              padding: '16px 32px',
              background: '#3b82f6',
              borderRadius: 10,
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 16,
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
          >
            Get Started - It's Free
          </Link>
          <a
            href="#how-it-works"
            style={{
              padding: '16px 32px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid #374151',
              borderRadius: 10,
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 500,
              fontSize: 16,
            }}
          >
            Learn More
          </a>
        </div>
      </section>

      {/* Features Section */}
      <section style={{
        padding: '80px 24px',
        background: '#111827',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <h2 style={{ color: '#fff', fontSize: 36, fontWeight: 700, margin: '0 0 16px' }}>
              Everything You Need to Compete
            </h2>
            <p style={{ color: '#6b7280', fontSize: 18, maxWidth: 600, margin: '0 auto' }}>
              All the features of fantasy sports, powered by real stock market data.
            </p>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 24,
          }}>
            {features.map((feature, idx) => (
              <div
                key={idx}
                style={{
                  background: '#1a1f2e',
                  borderRadius: 12,
                  padding: 28,
                  border: '1px solid #2a3040',
                }}
              >
                <div style={{ fontSize: 40, marginBottom: 16 }}>{feature.icon}</div>
                <h3 style={{ color: '#fff', fontSize: 20, fontWeight: 600, margin: '0 0 12px' }}>
                  {feature.title}
                </h3>
                <p style={{ color: '#9ca3af', fontSize: 15, lineHeight: 1.6, margin: 0 }}>
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" style={{
        padding: '80px 24px',
        background: '#0b1120',
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <h2 style={{ color: '#fff', fontSize: 36, fontWeight: 700, margin: '0 0 16px' }}>
              How It Works
            </h2>
            <p style={{ color: '#6b7280', fontSize: 18 }}>
              Get started in minutes. Here's how to play.
            </p>
          </div>
          <div style={{ display: 'grid', gap: 24 }}>
            {steps.map((step, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  gap: 24,
                  alignItems: 'flex-start',
                  padding: 24,
                  background: '#111827',
                  borderRadius: 12,
                  border: '1px solid #1f2937',
                }}
              >
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#3b82f6',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 20,
                  flexShrink: 0,
                }}>
                  {step.num}
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>
                    {step.title}
                  </h3>
                  <p style={{ color: '#9ca3af', fontSize: 16, lineHeight: 1.6, margin: 0 }}>
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section style={{
        padding: '80px 24px',
        background: 'linear-gradient(180deg, #111827 0%, #0b1120 100%)',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ color: '#fff', fontSize: 36, fontWeight: 700, margin: '0 0 16px' }}>
            Ready to Start Competing?
          </h2>
          <p style={{ color: '#9ca3af', fontSize: 18, marginBottom: 32 }}>
            Create your free account and start a league with your friends today.
          </p>
          <Link
            to="/signup"
            style={{
              display: 'inline-block',
              padding: '16px 40px',
              background: '#3b82f6',
              borderRadius: 10,
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 18,
            }}
          >
            Create Free Account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        padding: '40px 24px',
        background: '#0b1120',
        borderTop: '1px solid #1f2937',
        textAlign: 'center',
      }}>
        <div style={{ color: '#6b7280', fontSize: 14 }}>
          © {new Date().getFullYear()} Stockpile. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
