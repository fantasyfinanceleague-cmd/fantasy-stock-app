import type { ReactNode } from 'react';
import { Text } from './Text';
import { Button, type ButtonProps } from './Button';
import './EmptyState.css';

export interface EmptyStateProps {
  /** A single glyph/emoji or small icon element. Kept generic (no icon
   * library decision made in Phase 2). */
  icon?: ReactNode;
  title: string;
  /** The one supporting line — this pattern deliberately doesn't support
   * a second paragraph (DESIGN_DIRECTION §2: "the ONE empty-state pattern:
   * icon, title, one line, one action"). */
  line?: string;
  action?: { label: string; onClick: () => void; variant?: ButtonProps['variant'] };
  className?: string;
}

export function EmptyState({ icon, title, line, action, className }: EmptyStateProps) {
  return (
    <div className={['sp-empty-state', className].filter(Boolean).join(' ')}>
      {icon && (
        <div className="sp-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <Text variant="title" as="p">
        {title}
      </Text>
      {line && (
        <Text variant="body" tone="secondary" as="p">
          {line}
        </Text>
      )}
      {action && (
        <Button variant={action.variant ?? 'primary'} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export default EmptyState;
