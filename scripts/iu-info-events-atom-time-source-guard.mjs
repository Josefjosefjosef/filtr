#!/usr/bin/env node
/**
 * Guard: Atom feed times must not collapse into rss_pub_date.
 * Foundation for target architecture §4.5 / §10.1 — does not activate new SoT.
 */
import { extractFeedItems } from "./iu-info-events-lib.mjs";
import { applyChronology } from "./iu-info-events-v2.mjs";

function fail(msg) {
  console.error("FAIL " + msg);
  process.exit(1);
}

const atomXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom entry</title>
    <link href="https://example.test/atom-1"/>
    <published>2026-07-18T10:00:00Z</published>
  </entry>
  <entry>
    <title>Atom updated only</title>
    <link href="https://example.test/atom-2"/>
    <updated>2026-07-18T11:00:00Z</updated>
  </entry>
</feed>`;

const rssXml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>RSS item</title>
    <link>https://example.test/rss-1</link>
    <pubDate>Sat, 18 Jul 2026 10:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const atomItems = extractFeedItems(atomXml);
const rssItems = extractFeedItems(rssXml);

if (atomItems.length !== 2) fail("expected 2 atom entries, got " + atomItems.length);
if (atomItems[0].feedFormat !== "atom") fail("atom feedFormat");
if (atomItems[0].timeSourceHint !== "atom_published") fail("atom_published hint");
if (atomItems[1].timeSourceHint !== "atom_updated") fail("atom_updated hint");
if (rssItems[0].feedFormat !== "rss") fail("rss feedFormat");
if (rssItems[0].timeSourceHint !== "rss_pub_date") fail("rss_pub_date hint");

const now = "2026-07-18T12:00:00.000Z";
const chronAtom = applyChronology(
  {
    id: "t-atom",
    url: "https://example.test/atom-1",
    publishedAtSource: "2026-07-18T10:00:00.000Z",
    timeSourceHint: "atom_published",
    _hasSourcePubDate: true,
  },
  now,
  new Map()
);
if (chronAtom.timeSource !== "atom_published") fail("chronology must keep atom_published, got " + chronAtom.timeSource);
if (chronAtom.timeSource === "rss_pub_date") fail("atom must not become rss_pub_date");

console.log("PASS iu-info-events-atom-time-source-guard checks=6");
process.exit(0);
