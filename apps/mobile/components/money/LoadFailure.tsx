/**
 * LoadFailure: a LOAD failure on a money screen (Design Lead ruling, §9B):
 * the sp alert icon in the EmptyState disc, tone text2, never red, saying what
 * failed and offering Try again. Field errors stay text-only (danger colour);
 * refusals and blockers keep their warn-tint card with no icon. This component
 * is only for a read that didn't load.
 */
import React from 'react';

import { EmptyState } from '@/components/sp/EmptyState';
import { Icon } from '@/components/sp/Icon';
import { COPY } from '@/lib/money/moneyCopy';

export interface LoadFailureProps {
  /** What failed, in a short title ("Your portfolio didn't load"). */
  title: string;
  /** One line on what to do ("Check your connection, then try again."). */
  message: string;
  onRetry: () => void;
}

export function LoadFailure({ title, message, onRetry }: LoadFailureProps) {
  return (
    <EmptyState
      // The EmptyState draws the disc and passes size/colour; the glyph is ours.
      icon={() => <Icon name="alert" size="title" tone="text2" />}
      title={title}
      message={message}
      actionLabel={COPY.tryAgain}
      onAction={onRetry}
    />
  );
}
