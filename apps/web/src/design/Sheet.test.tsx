import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { Sheet } from './Sheet';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open trigger</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Test sheet">
        <button>First</button>
        <button>Last</button>
      </Sheet>
    </div>
  );
}

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    render(<Sheet open={false} onClose={() => {}} title="Closed sheet" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a labelled dialog when open', () => {
    render(<Sheet open onClose={() => {}} title="Open sheet" />);
    expect(screen.getByRole('dialog', { name: 'Open sheet' })).toBeInTheDocument();
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="Sheet" />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus into the panel on open, and restores it to the trigger on close', () => {
    render(<Harness />);
    const trigger = screen.getByText('Open trigger');
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    expect(screen.getByText('First')).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('Tab from the last focusable wraps to the first (focus trap)', () => {
    render(<Sheet open onClose={() => {}} title="Sheet">
      <button>First</button>
      <button>Last</button>
    </Sheet>);
    const last = screen.getByText('Last');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByText('First')).toHaveFocus();
  });

  it('Shift+Tab from the first focusable wraps to the last', () => {
    render(<Sheet open onClose={() => {}} title="Sheet">
      <button>First</button>
      <button>Last</button>
    </Sheet>);
    const first = screen.getByText('First');
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByText('Last')).toHaveFocus();
  });

  it('clicking the backdrop calls onClose', () => {
    // Sheet portals into document.body, not the render's own container.
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="Sheet" />);
    const backdrop = document.querySelector('.sp-sheet-backdrop');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalled();
  });
});
