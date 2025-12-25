import React from 'react';

/**
 * Base skeleton element with pulse animation
 */
export function Skeleton({ width = '100%', height = 16, borderRadius = 4, style = {} }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        backgroundColor: '#374151',
        animation: 'pulse 1.5s ease-in-out infinite',
        ...style,
      }}
    />
  );
}

/**
 * Skeleton for text lines
 */
export function SkeletonText({ lines = 1, width = '100%', gap = 8 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 && lines > 1 ? '70%' : width}
          height={14}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton for a card/metric box
 */
export function SkeletonCard({ height = 120 }) {
  return (
    <div
      className="card"
      style={{
        height,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
      }}
    >
      <Skeleton width={80} height={12} />
      <Skeleton width={120} height={28} />
      <Skeleton width={100} height={14} />
    </div>
  );
}

/**
 * Skeleton for a table row
 */
export function SkeletonTableRow({ columns = 5 }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} style={{ padding: '12px 8px' }}>
          <Skeleton width={i === 0 ? 60 : i === 1 ? 120 : 50} height={14} />
        </td>
      ))}
    </tr>
  );
}

/**
 * Skeleton for multiple table rows
 */
export function SkeletonTable({ rows = 5, columns = 5 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTableRow key={i} columns={columns} />
      ))}
    </>
  );
}

/**
 * Skeleton for a list item row
 */
export function SkeletonListRow() {
  return (
    <div
      className="list-row"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 0',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton width={140} height={16} />
        <Skeleton width={200} height={12} />
      </div>
      <Skeleton width={80} height={14} />
    </div>
  );
}

/**
 * Skeleton for the dashboard metrics row (3 cards)
 */
export function SkeletonMetricsRow() {
  return (
    <div className="metrics-row" style={{ marginBottom: 16 }}>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}

/**
 * Skeleton for a stock performer card
 */
export function SkeletonPerformerCard() {
  return (
    <div className="card" style={{ background: '#111826', padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <Skeleton width={50} height={16} />
        <Skeleton width={100} height={12} />
      </div>
      <Skeleton width={60} height={12} style={{ marginBottom: 6 }} />
      <Skeleton width="100%" height={8} borderRadius={6} />
    </div>
  );
}

/**
 * Skeleton for the portfolio page
 */
export function SkeletonPortfolio() {
  return (
    <div className="page">
      {/* Header */}
      <div className="portfolio-controls">
        <div className="portfolio-controls-left">
          <Skeleton width={200} height={24} style={{ marginBottom: 8 }} />
          <Skeleton width={300} height={14} />
        </div>
        <div className="portfolio-controls-right" style={{ display: 'flex', gap: 12 }}>
          <Skeleton width={180} height={36} borderRadius={6} />
          <Skeleton width={100} height={36} borderRadius={6} />
          <Skeleton width={120} height={36} borderRadius={6} />
        </div>
      </div>

      {/* Metrics */}
      <div className="metrics-row">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>

      {/* Table */}
      <div className="card" style={{ marginTop: 16 }}>
        <Skeleton width={150} height={20} style={{ marginBottom: 16 }} />
        <div className="table-wrap">
          <table className="holdings-table" style={{ width: '100%' }}>
            <tbody>
              <SkeletonTable rows={5} columns={8} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton for the dashboard page
 */
export function SkeletonDashboard() {
  return (
    <div className="page" style={{ paddingTop: 24 }}>
      {/* Metrics row */}
      <SkeletonMetricsRow />

      {/* Row 1 */}
      <div className="dashboard-row-2">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <Skeleton width={140} height={20} />
            <Skeleton width={100} height={32} borderRadius={6} />
          </div>
          {[1, 2, 3].map(i => (
            <SkeletonListRow key={i} />
          ))}
        </div>
        <div className="card">
          <Skeleton width={120} height={20} style={{ marginBottom: 16 }} />
          {[1, 2, 3].map(i => (
            <Skeleton key={i} width="100%" height={56} borderRadius={8} style={{ marginBottom: 10 }} />
          ))}
        </div>
      </div>

      {/* Row 2 */}
      <div className="dashboard-row-2">
        <div className="card">
          <Skeleton width={160} height={20} style={{ marginBottom: 16 }} />
          {[1, 2, 3].map(i => (
            <SkeletonPerformerCard key={i} />
          ))}
        </div>
        <div className="card">
          <Skeleton width={180} height={20} style={{ marginBottom: 16 }} />
          {[1, 2, 3].map(i => (
            <SkeletonListRow key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton for the leaderboard page
 */
export function SkeletonLeaderboard() {
  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Skeleton width={150} height={28} />
        <Skeleton width={180} height={36} borderRadius={6} />
      </div>
      <div className="card">
        <table style={{ width: '100%' }}>
          <tbody>
            <SkeletonTable rows={8} columns={6} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
