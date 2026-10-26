import { useEffect, useState } from "react";
function readRoute() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const filter = params.get("filter");
  return {
    settings: view === "settings",
    repoModal:
      view === "repositories"
        ? {
            view: ["attention", "all", "pull", "push", "project"].includes(
              filter,
            )
              ? filter
              : "attention",
            key: params.get("repo") || null,
          }
        : null,
  };
}
export function useViewRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (next) => {
    const url = new URL(window.location.href);
    ["view", "filter", "repo"].forEach((key) => url.searchParams.delete(key));
    if (next.settings) url.searchParams.set("view", "settings");
    else if (next.repoModal) {
      url.searchParams.set("view", "repositories");
      url.searchParams.set("filter", next.repoModal.view);
      if (next.repoModal.key) url.searchParams.set("repo", next.repoModal.key);
    }
    if (url.href !== window.location.href)
      window.history.pushState(null, "", url);
    setRoute(next);
  };
  return {
    ...route,
    setSettings: (opened) => navigate({ settings: opened, repoModal: null }),
    setRepoModal: (value) =>
      navigate({
        settings: false,
        repoModal: typeof value === "function" ? value(route.repoModal) : value,
      }),
  };
}
