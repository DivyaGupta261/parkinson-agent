import { describe, expect, it } from "vitest";
import {
  buildCitationEntries,
  citationAnchorId,
  citationIdFromHref,
  citationUrl,
  extractCitationIds,
  linkifyCitations,
  normalizeCitationId,
} from "./citations";
import type { Citation } from "./types";

function citation(id: string, exists = true): Citation {
  return {
    id,
    kind: id.startsWith("NCT") ? "trial" : "pubmed",
    exists,
    title: `Title of ${id}`,
    url: citationUrl(id),
    year: "2024",
    source: "Mov Disord",
  };
}

describe("normalizeCitationId", () => {
  it("normalises spacing and case", () => {
    expect(normalizeCitationId("PMID:123")).toBe("PMID:123");
    expect(normalizeCitationId("pmid: 123")).toBe("PMID:123");
    expect(normalizeCitationId("nct01234567")).toBe("NCT01234567");
  });

  it("rejects anything else", () => {
    expect(normalizeCitationId("NCT123")).toBeNull();
    expect(normalizeCitationId("DOI:10.1/x")).toBeNull();
    expect(normalizeCitationId("")).toBeNull();
  });
});

describe("citationUrl", () => {
  it("links PubMed and ClinicalTrials.gov", () => {
    expect(citationUrl("PMID:31234567")).toBe("https://pubmed.ncbi.nlm.nih.gov/31234567/");
    expect(citationUrl("NCT01234567")).toBe("https://clinicaltrials.gov/study/NCT01234567");
  });
});

describe("anchors", () => {
  it("round-trips an id through the card anchor", () => {
    for (const id of ["PMID:31234567", "NCT01234567"]) {
      expect(citationIdFromHref(`#${citationAnchorId(id)}`)).toBe(id);
    }
  });

  it("ignores ordinary links", () => {
    expect(citationIdFromHref("https://example.com")).toBeNull();
    expect(citationIdFromHref("#/notes")).toBeNull();
    expect(citationIdFromHref(undefined)).toBeNull();
  });
});

describe("linkifyCitations", () => {
  it("turns a single citation into a link to its card", () => {
    expect(linkifyCitations("Exercise helps [PMID:31234567].")).toBe(
      "Exercise helps [PMID:31234567](#cite-PMID-31234567).",
    );
  });

  it("handles trials", () => {
    expect(linkifyCitations("Recruiting [NCT01234567].")).toBe(
      "Recruiting [NCT01234567](#cite-NCT01234567).",
    );
  });

  it("splits grouped citations into one link each", () => {
    expect(linkifyCitations("Two trials [PMID:1; PMID: 2, NCT01234567].")).toBe(
      "Two trials [PMID:1](#cite-PMID-1)[PMID:2](#cite-PMID-2)[NCT01234567](#cite-NCT01234567).",
    );
  });

  it("leaves existing links and code alone", () => {
    const text = "See [PMID:1](https://x.org) and `[PMID:2]`.\n\n```\n[PMID:3]\n```";
    expect(linkifyCitations(text)).toBe(text);
  });

  it("leaves text without citations unchanged", () => {
    expect(linkifyCitations("No sources [here] or [PMID:abc].")).toBe(
      "No sources [here] or [PMID:abc].",
    );
  });
});

describe("extractCitationIds", () => {
  it("returns unique ids in reading order", () => {
    const md = "A [NCT01234567]. B [PMID:2; PMID:1]. C [PMID:2]. `[PMID:9]`";
    expect(extractCitationIds(md)).toEqual(["NCT01234567", "PMID:2", "PMID:1"]);
  });
});

describe("buildCitationEntries", () => {
  it("numbers cited ids first, then extra server items", () => {
    const md = "A [PMID:2]. B [PMID:1].";
    const items = [citation("PMID:1"), citation("PMID:2", false), citation("NCT01234567")];
    const entries = buildCitationEntries(md, items);
    expect(entries.map((e) => [e.number, e.id])).toEqual([
      [1, "PMID:2"],
      [2, "PMID:1"],
      [3, "NCT01234567"],
    ]);
    expect(entries[0]?.citation?.exists).toBe(false);
  });

  it("keeps cited ids the server has not reported on yet", () => {
    const entries = buildCitationEntries("A [PMID:5].", []);
    expect(entries).toEqual([{ number: 1, id: "PMID:5", citation: null }]);
  });
});
