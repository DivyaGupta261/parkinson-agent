import { useRef, type ButtonHTMLAttributes, type MouseEvent, type PointerEvent, type Ref } from "react";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  onPress: () => void;
  /** Ignore a second press within this many ms (accidental double-tap). */
  guardMs?: number;
  variant?: "primary" | "secondary" | "danger" | "plain";
  ref?: Ref<HTMLButtonElement>;
}

/** How far (px) a finger may drift outside the button and still count. */
const SLOP_PX = 24;

/**
 * A button built for hands with tremor:
 * - It acts when the finger LIFTS (pointerup), not when it lands, so a shaky
 *   landing can be corrected before anything happens.
 * - It captures the pointer, so a finger that wobbles a little off the edge
 *   still counts. Sliding well away (more than SLOP_PX) cancels the press.
 * - A second press within `guardMs` is ignored (tremor double-taps).
 * - Keyboard and screen readers still work: they fire a click with
 *   `detail === 0`, which we handle; pointer-generated clicks are skipped
 *   because the pointerup handler already acted.
 */
export function TremorButton({ onPress, guardMs = 250, variant = "primary", className, ...rest }: Props) {
  const lastPress = useRef(-Infinity);
  const activePointer = useRef<number | null>(null);

  const fire = () => {
    const now = performance.now();
    if (now - lastPress.current < guardMs) return;
    lastPress.current = now;
    onPress();
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    activePointer.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some older browsers don't support capture; the press still works.
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    const r = e.currentTarget.getBoundingClientRect();
    const inside =
      e.clientX >= r.left - SLOP_PX &&
      e.clientX <= r.right + SLOP_PX &&
      e.clientY >= r.top - SLOP_PX &&
      e.clientY <= r.bottom + SLOP_PX;
    if (inside) fire();
  };

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0) fire(); // keyboard (Enter/Space) or assistive tech
  };

  return (
    <button
      type="button"
      {...rest}
      className={`btn btn-${variant}${className ? ` ${className}` : ""}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (activePointer.current = null)}
      onClick={onClick}
    />
  );
}
