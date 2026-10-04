import { describe, expect, it } from "vitest";
import { normalizeFileOpening, openRequestPolicy } from "./file-opening";

describe("external file opening policy", () => {
  it("migrates existing preferences and rejects invalid settings", () => {
    expect(normalizeFileOpening(undefined)).toEqual({ mode: "read", focus: false, target: "new", startup: "restore" });
    expect(normalizeFileOpening({ mode: "invalid", focus: "true", target: "invalid" })).toEqual(normalizeFileOpening(null));
  });
  it("applies focus and reading to system files without spawning another initial window", () => {
    const prefs = normalizeFileOpening({ focus: true });
    expect(openRequestPolicy({ id: 0, source: "system", initial: true }, prefs, "split")).toEqual({ newWindow: false, mode: "read", focus: true });
    expect(openRequestPolicy({ id: 1, source: "system", initial: false }, prefs, "split").newWindow).toBe(true);
  });
  it("can reuse the current window and keeps explicit internal new windows independent", () => {
    const prefs = normalizeFileOpening({ target: "current", mode: "last", focus: true });
    expect(openRequestPolicy({ id: 1, source: "system", initial: false }, prefs, "split")).toEqual({ newWindow: false, mode: "split", focus: true });
    expect(openRequestPolicy({ id: 2, source: "internal", initial: false }, prefs, "source")).toEqual({ newWindow: true, mode: "source", focus: false });
  });
});
