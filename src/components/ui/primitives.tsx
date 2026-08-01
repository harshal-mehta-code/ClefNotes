import type { ReactNode, CSSProperties } from 'react';

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`lbl ${className}`}>{children}</div>;
}

export function Panel({
  title,
  children,
  right,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-3 ${className}`}>
      {(title || right) && (
        <header className="mb-2.5 flex items-center gap-2">
          {title && <div className="lbl">{title}</div>}
          {right && <div className="ml-auto">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Chip({
  on,
  onClick,
  children,
  title,
  style,
}: {
  on?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={on}
      className={`chip ${on ? 'chip-on' : ''}`}
      style={style}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="lbl">{label}</span>
      <span className="num text-[12px]" style={{ color: tone }}>
        {value}
      </span>
    </div>
  );
}

export function Meter({ value, tone = 'rgb(var(--ok))' }: { value: number; tone?: string }) {
  return (
    <div className="h-[7px] bg-sunk" role="presentation">
      <div
        className="h-full"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: tone }}
      />
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-rule2 p-8 text-center">
      <div className="font-display text-[17px] font-bold tracking-tight">{title}</div>
      {children && <div className="mt-1.5 text-[14px] text-ink2">{children}</div>}
    </div>
  );
}

/** A number that changes without the layout jumping around it. */
export function Num({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`num ${className}`}>{children}</span>;
}
