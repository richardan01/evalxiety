import { describe, expect, it, vi } from "vitest";
import { handle } from "./http";

describe("handle", () => {
  it("keeps a plain error message", async () => {
    const res = await handle(async () => {
      throw new Error("Annotation not found");
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Annotation not found");
  });

  it("does not echo file-system or parse errors; it returns a reference and logs the detail", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fsErr = Object.assign(new Error("ENOENT: no such file or directory, open '/home/me/data/x.json'"), { code: "ENOENT" });
    for (const err of [fsErr, new SyntaxError("Unexpected token } in JSON at position 4")]) {
      const res = await handle(async () => {
        throw err;
      });
      const { error } = await res.json();
      expect(res.status).toBe(500);
      expect(error).toMatch(/^Internal error \(ref [0-9a-f]{8}\)/);
      expect(error).not.toContain("/home/me");
    }
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
