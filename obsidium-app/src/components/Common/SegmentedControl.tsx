import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import '../../styles/components/segmented-control.css';

interface SegmentedControlOption {
  label: ReactNode;
  value: string;
}

interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  stretch?: boolean;
  className?: string;
}

export function SegmentedControl({ options, value, onChange, stretch = false, className = '' }: SegmentedControlProps) {
  const stretched = stretch ? ' q-segmented-control--stretch' : '';
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = options.findIndex((option) => option.value === value);
  const tabbableIndex = activeIndex === -1 ? 0 : activeIndex;

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number, step: number) => {
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    buttonsRef.current[next]?.focus();
  };

  return (
    <div className={`q-segmented-control${stretched} ${className}`.trim()} role="radiogroup">
      {options.map((option, index) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttonsRef.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === tabbableIndex ? 0 : -1}
            className={`q-segmented-control__button${active ? ' q-segmented-control__button--active' : ''}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(event, index, 1);
              else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(event, index, -1);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
