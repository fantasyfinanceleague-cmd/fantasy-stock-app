import { Link, useLocation } from 'react-router-dom';

/**
 * Breadcrumbs component for navigation hierarchy.
 * Automatically generates breadcrumbs based on the current path.
 *
 * @param {Array} items - Optional custom breadcrumb items [{ label, to }]
 * @param {string} currentPage - Label for the current page (last item)
 */
export default function Breadcrumbs({ items, currentPage }) {
  const location = useLocation();

  // Generate breadcrumbs from path if no custom items provided
  const generateBreadcrumbs = () => {
    if (items) return items;

    const pathSegments = location.pathname.split('/').filter(Boolean);
    const breadcrumbs = [];

    // Map path segments to readable labels
    const labelMap = {
      leagues: 'Leagues',
      league: 'League',
      draft: 'Draft',
      portfolio: 'Portfolio',
      leaderboard: 'Leaderboard',
      profile: 'Profile',
      'trade-history': 'Trade History',
      join: 'Join League',
    };

    let currentPath = '';
    pathSegments.forEach((segment, index) => {
      currentPath += `/${segment}`;

      // Skip UUID segments (league IDs, etc.) - they'll be replaced by currentPage
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);

      if (!isUuid) {
        breadcrumbs.push({
          label: labelMap[segment] || segment.charAt(0).toUpperCase() + segment.slice(1),
          to: currentPath,
        });
      }
    });

    return breadcrumbs;
  };

  const breadcrumbs = generateBreadcrumbs();

  // Don't show breadcrumbs for root-level pages
  if (breadcrumbs.length <= 1 && !currentPage) {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}
    >
      {/* Home link */}
      <Link
        to="/"
        style={{
          color: '#6b7280',
          textDecoration: 'none',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </Link>

      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1 && !currentPage;

        return (
          <span key={crumb.to} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#4b5563' }}>/</span>
            {isLast ? (
              <span style={{ color: '#e5e7eb', fontWeight: 500 }}>
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.to}
                style={{
                  color: '#6b7280',
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => e.target.style.color = '#9ca3af'}
                onMouseLeave={(e) => e.target.style.color = '#6b7280'}
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}

      {/* Current page (if provided separately) */}
      {currentPage && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#4b5563' }}>/</span>
          <span style={{ color: '#e5e7eb', fontWeight: 500 }}>
            {currentPage}
          </span>
        </span>
      )}
    </nav>
  );
}
