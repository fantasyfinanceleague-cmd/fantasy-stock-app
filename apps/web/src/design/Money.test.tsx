import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Money } from './Money';
import { Surface } from './Surface';

describe('Money', () => {
  it('renders the formatted amount', () => {
    render(<Money value={56.8} sign="always" />);
    expect(screen.getByText('+$56.80')).toBeInTheDocument();
  });

  it('colours a gain green (money surface, base tier) by default', () => {
    render(<Money value={56.8} />);
    expect(screen.getByText('$56.80')).toHaveStyle({ color: 'var(--sp-color-data-gain-base)' });
  });

  it('colours a loss red', () => {
    render(<Money value={-56.8} />);
    expect(screen.getByText('−$56.80')).toHaveStyle({ color: 'var(--sp-color-data-loss-base)' });
  });

  it('zero is never green or red — it uses color.data.zero', () => {
    render(<Money value={0} />);
    expect(screen.getByText('$0.00')).toHaveStyle({ color: 'var(--sp-color-data-zero)' });
  });

  it('picks the onGame variant inside a game Surface', () => {
    render(
      <Surface kind="game">
        <Money value={56.8} />
      </Surface>
    );
    expect(screen.getByText('$56.80')).toHaveStyle({ color: 'var(--sp-color-data-gain-on-game)' });
  });

  it('colorBySign=false does not override the surface text colour', () => {
    render(<Money value={-56.8} colorBySign={false} />);
    const el = screen.getByText('−$56.80');
    expect(el.style.color).not.toBe('var(--sp-color-data-loss-base)');
  });

  it('always renders tabular-nums', () => {
    render(<Money value={56.8} />);
    expect(screen.getByText('$56.80')).toHaveStyle({ fontVariantNumeric: 'tabular-nums' });
  });
});
