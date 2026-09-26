import type { ReactNode } from 'react';
import { Text } from './Text';
import { Button, type ButtonProps } from './Button';
import { useSurfaceKind } from './Surface';
import './EmptyState.css';

export interface EmptyStateProps {
  /** A real vector icon (an inline SVG), NOT an emoji glyph — emoji render
   * differently per OS, and this is the pattern every empty state follows.
   * Rendered inside a soft circular slot; size/colour it with `currentColor`
   * so it inherits the slot's colour automatically. No icon library
   * decision has been made in Phase 2, so this stays a generic ReactNode. */
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
  const surfaceKind = useSurfaceKind();
  return (
    <div className={['sp-empty-state', className].filter(Boolean).join(' ')}>
      {icon && (
        <div className={`sp-empty-state__icon-slot sp-empty-state__icon-slot--${surfaceKind}`} aria-hidden="true">
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
