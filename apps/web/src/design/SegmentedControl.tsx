import { useRef, type KeyboardEvent } from 'react';
import './SegmentedControl.css';

export interface SegmentedControlOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  'aria-label': string;
  className?: string;
}

/** A `radiogroup` with roving tabindex: arrow keys (and Home/End) move
 * focus AND select, matching native tab/radio-group behaviour. Only the
 * selected option is in the tab order. */
export function SegmentedControl({
  options,
  value,
  onChange,
  className,
  ...rest
}: SegmentedControlProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );

  function moveTo(index: number) {
    const clamped = (index + options.length) % options.length;
    buttonRefs.current[clamped]?.focus();
    onChange(options[clamped].value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveTo(selectedIndex + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveTo(selectedIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        moveTo(options.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      className={['sp-segmented', className].filter(Boolean).join(' ')}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={['sp-segmented__option', selected && 'sp-segmented__option--selected']
              .filter(Boolean)
              .join(' ')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
