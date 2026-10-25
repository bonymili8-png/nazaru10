import { describe, expect, it } from "vitest";
import { horseMeta, injectMeta, raceMeta, UUID } from "./og";

const page = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><title>Thoroughline — Racing Stable</title><meta name="description" content="Build your racing stable"/><meta property="og:title" content="old"/></head><body>app</body></html>`;

describe("share page previews", () => {
  it("describes a finished race by its winner, with the API's preview image", () => {
    const m = raceMeta(
      {
        name: "Royal Meadow Downs Class 5",
        trackName: "Royal Meadow Downs",
        distance: 1400,
        surface: "TURF",
        entryList: [
          { horseName: "Night Comet", position: 2 },
          { horseName: "Bold Ruler", position: 1 },
        ],
      },
      "11111111-2222-4333-8444-555555555555",
      "https://api.example.com",
      "https://game.example.com/replay/?id=1",
    );
    expect(m.title).toBe("Bold Ruler wins the Royal Meadow Downs Class 5 | Thoroughline");
    expect(m.description).toContain("1400m Turf");
    expect(m.description).toContain("No betting");
    expect(m.image).toBe("https://api.example.com/public/og/race/11111111-2222-4333-8444-555555555555");
  });

  it("describes a horse by its record", () => {
    const m = horseMeta(
      { name: "Bold Ruler", starts: 12, wins: 4, raceRating: 1184 },
      "x",
      "https://a",
      "https://p",
    );
    expect(m.title).toBe("Bold Ruler: 12 starts, 4 wins | Thoroughline");
    expect(m.description).toContain("Can your horse beat Bold Ruler?");
  });

  it("replaces the page's title and preview tags, escaping values", () => {
    const html = injectMeta(page, {
      title: 'Ruler "R" <wins> & more',
      description: "d",
      image: "https://a/img",
      url: "https://p/?id=1&r=X",
    });
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain("<title>Ruler &quot;R&quot; &lt;wins&gt; &amp; more</title>");
    expect(html).not.toContain("Racing Stable");
    expect(html).not.toContain('content="old"');
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html).toContain('<meta property="og:image" content="https://a/img"/>');
    expect(html).toContain('content="https://p/?id=1&amp;r=X"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    expect(html.indexOf("<title>")).toBeGreaterThan(html.indexOf("<head>"));
    expect(html).toContain("<body>app</body>");
  });

  it("only accepts real ids", () => {
    expect(UUID.test("11111111-2222-4333-8444-555555555555")).toBe(true);
    expect(UUID.test("../../etc")).toBe(false);
  });
});
