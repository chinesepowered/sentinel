import { useEffect, useState } from "react";
import { EnsureSignedIn } from "./auth";
import { Dashboard } from "./Dashboard";
import { Setup } from "./Setup";
import { Home } from "./Home";
import { Admin } from "./Admin";

/**
 * Three real pages and one admin page, routed off the pathname so every case
 * and every printable setup sheet has a link the family can share. Convex
 * static hosting falls back to index.html, so a deep link works cold.
 */
function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export default function App() {
  const path = usePath();
  const shieldMatch = path.match(/^\/s\/([^/]+)\/?$/);
  const setupMatch = path.match(/^\/setup\/([^/]+)\/?$/);

  return (
    <EnsureSignedIn>
      {setupMatch ? (
        <Setup slug={decodeURIComponent(setupMatch[1])} />
      ) : shieldMatch ? (
        <Dashboard slug={decodeURIComponent(shieldMatch[1])} />
      ) : path.startsWith("/admin") ? (
        <Admin />
      ) : (
        <Home />
      )}
    </EnsureSignedIn>
  );
}
