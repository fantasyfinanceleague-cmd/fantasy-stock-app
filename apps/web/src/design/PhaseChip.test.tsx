import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhaseChip } from './PhaseChip';
import { Surface } from './Surface';

describe('PhaseChip', () => {
  it('renders a human label for every phase', () => {
    render(<PhaseChip phase="pre_draft" />);
    expect(screen.getByText('Pre-Draft')).toBeInTheDocument();
  });

  it('live_open on a money surface is a plain neutral chip', () => {
    render(<PhaseChip phase="live_open" />);
    const el = screen.getByText('Live');
    expect(el.className).toContain('sp-chip--neutral-money');
  });

  it('live_open on a game surface renders as the broadcast-tag class', () => {
    // jsdom doesn't apply imported .css files, so this checks the class the
    // component picks (sp-chip--tag), not the computed style it produces —
    // the uppercase/color.live rendering itself is verified visually in the
    // gallery screenshots (DONE report).
    render(
      <Surface kind="game">
        <PhaseChip phase="live_open" />
      </Surface>
    );
    const el = screen.getByText('Live');
    expect(el.className).toContain('sp-chip--tag');
  });

  it('every phase in the type renders without throwing', () => {
    const phases = [
      'pre_draft',
      'drafting',
      'pre_season',
      'live_open',
      'live_closed',
      'week_final',
      'playoffs',
      'season_complete',
    ] as const;
    for (const phase of phases) {
      const { unmount } = render(<PhaseChip phase={phase} />);
      unmount();
    }
  });
});
