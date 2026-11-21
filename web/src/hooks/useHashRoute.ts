import { useEffect, useState } from "react";

export type View = "ask" | "notes" | "digests";

export interface Route {
  view: View;
  /** Extra path segment, e.g. the digest date in #/digests/2026-11-19. */
  param: string | null;
}

const VIEWS: readonly View[] = ["ask", "notes", "digests"];

export function parseHash(hash: string): Route | null {
  // Only "#/..." hashes are routes; other fragments are left to the browser.
  if (!hash.startsWith("#/")) return null;
  const [view, param] = hash.slice(2).split("/");
  if (!VIEWS.includes(view as View)) return { view: "ask", param: null };
  return { view: view as View, param: param ? decodeURIComponent(param) : null };
}

export function routeHref(view: View, param?: string | null): string {
  return param ? `#/${view}/${encodeURIComponent(param)}` : `#/${view}`;
}

/** A tiny hash router: the back button and bookmarks work, no library needed. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(
    () => parseHash(window.location.hash) ?? { view: "ask", param: null },
  );

  useEffect(() => {
    const onChange = () => {
      const next = parseHash(window.location.hash);
      if (next) setRoute(next);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}
