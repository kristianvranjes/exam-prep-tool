const positionKey = "examPrepHistoryPosition";

/** Preserve Next's history data and undo a cancelled traversal before its popstate handler runs. */
export function installHistoryGuard(allow: (pathname: string) => boolean) {
  const history = window.history;
  const push = history.pushState;
  const replace = history.replaceState;
  let position: number = history.state?.[positionKey] ?? 0;
  let restoring = false;
  let disposed = false;
  replace.call(history, { ...history.state, [positionKey]: position }, "");
  const pushState: History["pushState"] = function (data, unused, url) {
    if (disposed) return push.call(history, data, unused, url);
    position += 1;
    return push.call(history, { ...data, [positionKey]: position }, unused, url);
  };
  const replaceState: History["replaceState"] = function (data, unused, url) {
    return replace.call(history, disposed ? data : { ...data, [positionKey]: position }, unused, url);
  };
  history.pushState = pushState;
  history.replaceState = replaceState;
  function traverse(event: PopStateEvent) {
    if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
    const target = event.state?.[positionKey];
    // Entries outside this workspace are protected by the native beforeunload warning.
    if (typeof target !== "number") return;
    if (!allow(window.location.pathname)) {
      event.stopImmediatePropagation();
      restoring = true;
      history.go(position - target);
    } else position = target;
  }
  window.addEventListener("popstate", traverse, true);
  return () => {
    disposed = true;
    window.removeEventListener("popstate", traverse, true);
    if (history.pushState === pushState) history.pushState = push;
    if (history.replaceState === replaceState) history.replaceState = replace;
  };
}
