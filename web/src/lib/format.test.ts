import { describe, expect, it } from "vitest";
import { formatCost, formatDateTime, formatDigestDate, parseUtc, toolInputSummary, toolLabel } from "./format";

describe("parseUtc", () => {
  it("treats a timestamp without an offset as UTC", () => {
    expect(parseUtc("2026-11-19T08:02:00")?.toISOString()).toBe("2026-11-19T08:02:00.000Z");
    expect(parseUtc("2026-11-19 08:02:00")?.toISOString()).toBe("2026-11-19T08:02:00.000Z");
  });

  it("respects an explicit offset", () => {
    expect(parseUtc("2026-11-19T08:02:00+00:00")?.toISOString()).toBe("2026-11-19T08:02:00.000Z");
    expect(parseUtc("2026-11-19T08:02:00Z")?.toISOString()).toBe("2026-11-19T08:02:00.000Z");
  });

  it("returns null for nonsense", () => {
    expect(parseUtc("yesterday")).toBeNull();
  });
});

describe("formatDateTime", () => {
  it("shows the time in IST", () => {
    const text = formatDateTime("2026-11-19T08:02:00Z");
    expect(text).toContain("19 Nov 2026");
    expect(text).toMatch(/1:32\s?pm IST$/i);
  });
});

describe("formatDigestDate", () => {
  it("does not shift calendar dates across time zones", () => {
    expect(formatDigestDate("2026-11-01")).toBe("1 November 2026");
  });
});

describe("formatCost", () => {
  it("keeps small costs readable", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(0.0462)).toBe("$0.0462");
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0)).toBe("$0.00");
  });
});

describe("tool display", () => {
  it("labels known tools and summarises their input", () => {
    expect(toolLabel("search_pubmed")).toBe("Searching PubMed");
    expect(toolLabel("new_tool")).toBe("Using new tool");
    expect(toolInputSummary({ query: "LRRK2", max_results: 10 })).toBe("LRRK2");
    expect(toolInputSummary({ pmids: ["1", "2"] })).toBe("1, 2");
    expect(toolInputSummary({ status: "recruiting", age: 42 })).toBe("status: recruiting · age: 42");
  });
});
