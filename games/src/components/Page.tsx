import { useEffect, useRef, type ReactNode } from "react";

/**
 * Every screen is a Page. When a new page appears, focus moves to its heading,
 * so keyboard and screen-reader users start at the top of the new content
 * instead of being left on the link they pressed.
 */
export function Page({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · Practice & tracking`;
    h1.current?.focus();
  }, [title]);
  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title" ref={h1} tabIndex={-1}>
        {title}
      </h1>
      {intro && <div className="intro">{intro}</div>}
      {children}
    </section>
  );
}
