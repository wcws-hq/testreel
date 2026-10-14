import { useEffect, useState } from "react";

export type Route = { name: "home" } | { name: "run"; id: string };

export const runHref = (id: string): string => `#/run/${encodeURIComponent(id)}`;

function parseHash(hash: string): Route {
  const m = hash.match(/^#\/run\/([^/?#]+)/);
  return m?.[1] ? { name: "run", id: decodeURIComponent(m[1]) } : { name: "home" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = (): void => {
      setRoute(parseHash(location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
