import { useEffect, useRef, useState } from "react";
export function Range({
  label,
  value,
  min = 0,
  max = 1,
  disabled = false,
  vertical = false,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  vertical?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current || disabled) {
      dirty.current = false;
      setDraft(value);
    }
  }, [value, disabled]);
  function commit() {
    if (dirty.current && !disabled) {
      dirty.current = false;
      onCommit(draft);
    }
  }
  return (
    <input
      className={vertical ? "fader" : ""}
      aria-label={label}
      aria-valuetext={
        min < 0
          ? draft === 0
            ? "Equal balance"
            : `${Math.round(Math.abs(draft) * 100)}% toward side ${draft < 0 ? "A" : "B"}`
          : `${Math.round(draft * 100)} percent`
      }
      type="range"
      min={min}
      max={max}
      step="0.01"
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        dirty.current = true;
        const v = Number(event.target.value);
        setDraft(min < 0 && Math.abs(v) < 0.04 ? 0 : v);
      }}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
      onPointerCancel={() => {
        dirty.current = false;
        setDraft(value);
      }}
    />
  );
}
