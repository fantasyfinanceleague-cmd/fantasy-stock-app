// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ScoreDigits } from './ScoreDigits';
import { TugBar, tugLabel } from './TugBar';
import { LiveDot } from './LiveDot';
import { Chyron } from './Chyron';
import { Scoreboard } from './Scoreboard';

describe('ScoreDigits', () => {
  it('renders the plain value in a visually-hidden node for assistive tech', () => {
    render(<ScoreDigits value="+$56.80" />);
    expect(screen.getByText('+$56.80', { selector: '.sp-visually-hidden' })).toBeInTheDocument();
  });

  it('renders each visible character', () => {
    const { container } = render(<ScoreDigits value="$0.00" />);
    const chars = container.querySelectorAll('.sp-score-digits__visual .sp-score-digits__char');
    expect(chars.length).toBe(5); // "$0.00" -> 5 characters
  });
});

describe('TugBar', () => {
  it('labels the lead in dollars (the ratio is visual only)', () => {
    render(<TugBar you={100} opponent={0} youLabel="You" opponentLabel="Priya" />);
    expect(screen.getByRole('img', { name: 'You lead by $100.00' })).toBeInTheDocument();
  });

  it('a tied matchup reads "Tied"', () => {
    render(<TugBar you={0} opponent={0} youLabel="You" opponentLabel="Priya" />);
    expect(screen.getByRole('img', { name: 'Tied' })).toBeInTheDocument();
  });

  it('names the opponent when they lead, with third-person grammar', () => {
    render(<TugBar you={39.4} opponent={56.8} youLabel="You" opponentLabel="Priya" />);
    expect(screen.getByRole('img', { name: 'Priya leads by $17.40' })).toBeInTheDocument();
  });

  it('takes the margin between two losses, and treats a sub-cent gap as a tie', () => {
    expect(tugLabel(-3, -10.5, 'You', 'Priya')).toBe('You lead by $7.50');
    expect(tugLabel(10.001, 10.004, 'You', 'Priya')).toBe('Tied');
  });

  it('never puts a percentage in front of assistive tech', () => {
    const cases: Array<[number, number]> = [
      [100, 0],
      [0, 100],
      [56.8, 39.4],
      [0, 0],
      [-12.75, 44.3],
      [1e6, 1],
    ];
    for (const [you, opp] of cases) expect(tugLabel(you, opp, 'You', 'Priya')).not.toContain('%');
    const { container } = render(<TugBar you={56.8} opponent={39.4} youLabel="You" opponentLabel="Priya" />);
    expect(container.innerHTML).not.toContain('%,');
    expect(container.querySelector('[aria-label]')?.getAttribute('aria-label')).not.toContain('%');
  });
});

describe('LiveDot', () => {
  it('renders a status role with the label reachable by assistive tech', () => {
    render(<LiveDot />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('accepts a custom label', () => {
    render(<LiveDot label="Market open" />);
    expect(screen.getByText('Market open')).toBeInTheDocument();
  });
});

describe('Chyron', () => {
  it('renders nothing when message is null', () => {
    render(<Chyron message={null} />);
    expect(screen.queryByRole('status')?.textContent).toBe('');
  });

  it('renders the message inside an aria-live region', () => {
    render(<Chyron message="NVDA just put you ahead" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toContain('NVDA just put you ahead');
  });

  it('auto-dismisses after autoDismissMs', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Chyron message="Hello" onDismiss={onDismiss} autoDismissMs={1000} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('regression: a parent re-render with a fresh inline onDismiss does not reset the dismiss timer', () => {
    // Found live in the gallery: an inline `() => setMessage(null)` is a
    // new function reference every render. When the effect scheduling the
    // dismiss timer depended on `onDismiss` directly, ANY parent re-render
    // (not just a message change) cleared and restarted the timer, so a
    // message could sit far longer than autoDismissMs, or dismiss at an
    // unpredictable time relative to when it was actually set.
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(<Chyron message="Hello" onDismiss={onDismiss} autoDismissMs={1000} />);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Re-render with the SAME message but a brand-new onDismiss reference —
    // this must NOT push the dismissal out further.
    rerender(<Chyron message="Hello" onDismiss={() => onDismiss()} autoDismissMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('regression: a new message mounts as a distinct element (keyed by message), not just changed text', () => {
    // Found live in the gallery: without `key={message}`, a message change
    // updated the SAME DOM node's text in place, so AnimatePresence had no
    // signal to treat it as a new element — `initial`/`animate` never
    // re-fired for the second message, and it just inherited whatever
    // animation state the first one was already in.
    //
    // jsdom never fires a real animation-complete event, so AnimatePresence
    // can't remove the old ("First") element once it starts exiting — both
    // coexist here, which is a jsdom/test-environment artifact, not a bug.
    // The behavior under test is that "Second" mounts as its OWN new node
    // rather than the "First" node's text simply changing to "Second".
    const { container, rerender } = render(<Chyron message="First" onDismiss={() => {}} />);
    expect(container.querySelectorAll('.sp-chyron')).toHaveLength(1);

    rerender(<Chyron message="Second" onDismiss={() => {}} />);
    const nodes = [...container.querySelectorAll('.sp-chyron')];
    expect(nodes.map((n) => n.textContent)).toEqual(['First', 'Second']);
  });
});

describe('Scoreboard', () => {
  it('renders both teams and a lead line naming the margin when you lead', () => {
    render(
      <Scoreboard
        leagueName="The League"
        week={3}
        you={{ name: 'Giorgio', gain: 120.5 }}
        opponent={{ name: 'Priya', gain: 40 }}
      />
    );
    expect(screen.getByText('Giorgio')).toBeInTheDocument();
    expect(screen.getByText('Priya')).toBeInTheDocument();
    // "You lead" (not "leads") — first person; the margin is the gain gap.
    expect(screen.getByText('You lead by $80.50')).toBeInTheDocument();
  });

  it('names the opponent with "leads" (third person) when they lead', () => {
    render(
      <Scoreboard
        leagueName="The League"
        week={3}
        you={{ name: 'Giorgio', gain: 40 }}
        opponent={{ name: 'Priya', gain: 120.5 }}
      />
    );
    expect(screen.getByText('Priya leads by $80.50')).toBeInTheDocument();
  });

  it('shows no lead line on a tie', () => {
    render(
      <Scoreboard
        leagueName="The League"
        week={3}
        you={{ name: 'Giorgio', gain: 0 }}
        opponent={{ name: 'Priya', gain: 0 }}
      />
    );
    expect(screen.queryByText(/leads? by/)).not.toBeInTheDocument();
  });

  it('shows the live dot only when live', () => {
    const { rerender } = render(
      <Scoreboard leagueName="L" week={1} you={{ name: 'A', gain: 1 }} opponent={{ name: 'B', gain: 0 }} />
    );
    expect(screen.queryByText('Live')).not.toBeInTheDocument();

    rerender(
      <Scoreboard live leagueName="L" week={1} you={{ name: 'A', gain: 1 }} opponent={{ name: 'B', gain: 0 }} />
    );
    expect(screen.getByText('Live')).toBeInTheDocument();
  });
});
