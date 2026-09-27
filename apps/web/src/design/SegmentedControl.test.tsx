import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
];

function Controlled({ initial = 'a' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <SegmentedControl options={OPTIONS} value={value} onChange={setValue} aria-label="Range" />;
}

describe('SegmentedControl', () => {
  it('renders a radiogroup with the selected option checked', () => {
    render(<Controlled />);
    expect(screen.getByRole('radiogroup', { name: 'Range' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'false');
  });

  it('only the selected option is in the tab order (roving tabindex)', () => {
    render(<Controlled />);
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight moves selection and focus to the next option', () => {
    render(<Controlled />);
    const group = screen.getByRole('radiogroup');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'B' })).toHaveFocus();
  });

  it('ArrowLeft/ArrowRight wrap around the ends', () => {
    render(<Controlled initial="c" />);
    const group = screen.getByRole('radiogroup');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Home/End jump to the first/last option', () => {
    render(<Controlled initial="b" />);
    const group = screen.getByRole('radiogroup');
    fireEvent.keyDown(group, { key: 'End' });
    expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(group, { key: 'Home' });
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true');
  });

  it('clicking an option selects it', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="a" onChange={onChange} aria-label="Range" />);
    fireEvent.click(screen.getByRole('radio', { name: 'C' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });
});
