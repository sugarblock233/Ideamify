import { afterEach, expect, it, vi } from "vitest";
import api from "../api";

const page = (items: unknown[], next_cursor: string | null) => new Response(JSON.stringify({ items, next_cursor }));
afterEach(() => vi.unstubAllGlobals());

it("loads every project page so old projects remain searchable", async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Project ${i}` }));
  const fetch = vi.fn().mockResolvedValueOnce(page(first, "page+2/="))
    .mockResolvedValueOnce(page([{ id: "100", name: "Old project" }], null));
  vi.stubGlobal("fetch", fetch);
  const result = await api.projects();
  expect(result.items).toHaveLength(101);
  expect(result.items[100].name).toBe("Old project");
  expect(fetch.mock.calls[1][0]).toBe("/api/v1/projects?limit=100&cursor=page%2B2%2F%3D");
  expect(fetch.mock.calls[0][1].headers.authorization).toBeUndefined();
});

it("restarts an invalidated page sequence without mixing old and new results", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(page([{ id: "outdated" }], "next"))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "PAGINATION_STALE", message: "changed" } }), { status: 409 }))
    .mockResolvedValueOnce(page([{ id: "current" }], null));
  vi.stubGlobal("fetch", fetch);
  expect((await api.projects()).items).toEqual([{ id: "current" }]);
  expect(fetch).toHaveBeenCalledTimes(3);
});
