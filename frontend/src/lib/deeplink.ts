/** Deep links (SPEC 3.4): /p/<project_uuid>?node=<node_uuid>.
 *  Tokens are NEVER part of the URL. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDeepLink(): { projectId?: string; nodeId?: string } {
  const m = window.location.pathname.match(/^\/p\/([0-9a-f-]{36})/i);
  const params = new URLSearchParams(window.location.search);
  const node = params.get("node");
  return {
    projectId: m?.[1] ? m[1].toLowerCase() : undefined,
    nodeId: node && UUID.test(node) ? node.toLowerCase() : undefined,
  };
}

export function deepLinkHref(projectId: string, nodeId?: string): string {
  return `/p/${projectId}${nodeId ? `?node=${nodeId}` : ""}`;
}

export function replaceDeepLink(projectId: string, nodeId?: string): void {
  window.history.replaceState(null, "", deepLinkHref(projectId, nodeId));
}

export function pushDeepLink(projectId: string, nodeId?: string): void {
  window.history.pushState(null, "", deepLinkHref(projectId, nodeId));
}