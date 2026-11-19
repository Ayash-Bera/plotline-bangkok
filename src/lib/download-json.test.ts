import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadJson } from "./download-json";

function browser() {
  const order: string[] = [];
  const links: { href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }[] = [];
  const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:study-${links.length + 1}`);
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => { order.push("revoke"); });
  const append = vi.fn((link: (typeof links)[number]) => { order.push("append"); return link; });
  vi.stubGlobal("document", {
    body: { appendChild: append },
    createElement: vi.fn(() => {
      const link = { href: "", download: "", click: vi.fn(() => { order.push("click"); }), remove: vi.fn(() => { order.push("remove"); }) };
      links.push(link);
      return link;
    }),
  });
  return { order, links, create, revoke, append };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("JSON download lifecycle", () => {
  it("activates an attached download containing the exact JSON and removes the link", async () => {
    const b = browser();
    const study = { scenario: { width: 20 }, result: { gfa: 999.999618 }, sources: ["rules"] };
    downloadJson(study, "study.json");
    const blob = b.create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual(study);
    expect(b.links[0].download).toBe("study.json");
    expect(b.links[0].href).toBe("blob:study-1");
    expect(b.append).toHaveBeenCalledWith(b.links[0]);
    expect(b.order).toEqual(["append", "click", "remove"]);
  });

  it("keeps the Blob URL alive after activation and releases it with bounded cleanup", () => {
    const b = browser();
    downloadJson({}, "study.json");
    expect(b.revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59_999);
    expect(b.revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(b.revoke).toHaveBeenCalledExactlyOnceWith("blob:study-1");
  });

  it("keeps repeated exports independent", () => {
    const b = browser();
    downloadJson({ revision: 1 }, "one.json");
    vi.advanceTimersByTime(500);
    downloadJson({ revision: 2 }, "two.json");
    vi.advanceTimersByTime(59_500);
    expect(b.revoke.mock.calls).toEqual([["blob:study-1"]]);
    vi.advanceTimersByTime(500);
    expect(b.revoke.mock.calls).toEqual([["blob:study-1"], ["blob:study-2"]]);
  });

  it("cleans up immediately if activation throws", () => {
    const b = browser();
    b.append.mockImplementation(link => {
      link.click.mockImplementation(() => { throw new Error("activation failed"); });
      return link;
    });
    expect(() => downloadJson({}, "study.json")).toThrow("activation failed");
    expect(b.links[0].remove).toHaveBeenCalledOnce();
    expect(b.revoke).toHaveBeenCalledExactlyOnceWith("blob:study-1");
    expect(vi.getTimerCount()).toBe(0);
  });
});
