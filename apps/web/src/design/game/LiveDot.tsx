import { useMotion } from '../useMotion';
import './LiveDot.css';
import './a11y.css';

export interface LiveDotProps {
  label?: string;
  className?: string;
}

/** Caller decides WHETHER to render this (only while the market is open);
 * the component itself decides whether to pulse. Reduced motion stops the
 * loop — the design's "exempt from nothing loops" is a full-motion style
 * choice, not an exemption from prefers-reduced-motion. */
export function LiveDot({ label = 'Live', className }: LiveDotProps) {
  const { reduced } = useMotion();
  return (
    <span
      className={['sp-live-dot', reduced ? 'sp-live-dot--static' : 'sp-live-dot--pulsing', className]
        .filter(Boolean)
        .join(' ')}
      role="status"
    >
      <span aria-hidden="true" className="sp-live-dot__mark" />
      <span className="sp-visually-hidden">{label}</span>
    </span>
  );
}

export default LiveDot;
