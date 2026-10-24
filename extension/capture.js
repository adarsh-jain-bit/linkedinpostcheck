// Shared by popup.js and background.js.

const DEFAULT_PORTAL = "http://localhost:3001";

// LinkedIn keeps search filters in the URL, so a filtered search is just a link
function buildSearchUrl(keyword, { datePosted = "", sortBy = "" } = {}) {
  const q = new URLSearchParams({ keywords: keyword, origin: "FACETED_SEARCH" });
  if (datePosted) q.set("datePosted", `"${datePosted}"`);
  if (sortBy) q.set("sortBy", `"${sortBy}"`);
  return `https://www.linkedin.com/search/results/content/?${q}`;
}

async function runInTab(tabId, func, args = [], world = "ISOLATED") {
  // Run in every frame in case LinkedIn renders results inside an iframe
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args, world });
  return results.map((r) => r.result).filter(Boolean);
}

async function captureTab(tabId, { pages = 0, links = true } = {}) {
  if (links) await runInTab(tabId, installCopyHook, [], "MAIN");
  const results = await runInTab(tabId, scrapeLinkedInPosts, [pages, links]);
  const seen = new Set();
  return results.flat().filter((p) => {
    const key = p.id || p.text.slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function sendToPortal(posts, { portal = DEFAULT_PORTAL, token = "" } = {}) {
  let res;
  try {
    res = await fetch(`${portal}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ingest-Token": token },
      body: JSON.stringify({ posts }),
    });
  } catch {
    throw new Error(`Can't reach the portal at ${portal}. Is it running (npm run dev)?`);
  }
  if (res.status === 404) throw new Error(`${portal} is not the Post Checker portal (got 404). Check the Portal URL.`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data; // { added, total }
}

// Runs in the page's own JS world. While capture is on, swallows LinkedIn's "copy link"
// clipboard writes and hands the text to the scraper via a DOM attribute.
function installCopyHook() {
  if (window.__lpcHooked) return true;
  window.__lpcHooked = true;
  const root = document.documentElement;
  const active = () => root.dataset.lpcCapture === "1";
  const save = (t) => (root.dataset.lpcCopied = String(t || ""));
  const cb = navigator.clipboard;
  if (cb) {
    const writeText = cb.writeText.bind(cb);
    const write = cb.write.bind(cb);
    cb.writeText = (t) => (active() ? (save(t), Promise.resolve()) : writeText(t));
    cb.write = async (items) => {
      if (!active()) return write(items);
      for (const it of items) {
        if (it.types.includes("text/plain")) save(await (await it.getType("text/plain")).text());
      }
    };
  }
  const exec = document.execCommand.bind(document);
  document.execCommand = (cmd, ...rest) => {
    if (active() && String(cmd).toLowerCase() === "copy") {
      const el = document.activeElement;
      save(el && "value" in el ? el.value : String(getSelection()));
      return true;
    }
    return exec(cmd, ...rest);
  };
  return true;
}

// Runs inside the LinkedIn tab. Must be self-contained (no outer references).
async function scrapeLinkedInPosts(scrollPages, getLinks) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (t) => (t || "").replace(/ /g, " ").trim();

  // LinkedIn sometimes scrolls an inner container instead of the window
  const scrollAll = () => {
    window.scrollTo(0, document.body.scrollHeight);
    for (const el of document.querySelectorAll("main, div")) {
      if (el.scrollHeight > el.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
        el.scrollTop = el.scrollHeight;
      }
    }
  };
  for (let i = 0; i < scrollPages; i++) {
    scrollAll();
    await sleep(1800);
    const more = [...document.querySelectorAll("button")].find((b) =>
      /show more results|load more|see more results/i.test(b.innerText)
    );
    if (more) {
      more.click();
      await sleep(1500);
    }
  }

  // Expand truncated posts ("…see more" / "…more")
  for (const b of document.querySelectorAll("button, span[role='button']")) {
    const t = clean(b.innerText);
    if (/^(…|\.\.\.)?\s*(see )?more$/i.test(t) || /see more/i.test(b.getAttribute("aria-label") || "")) b.click();
  }
  await sleep(800);

  // 1) Known post containers
  const known = [
    ...document.querySelectorAll(
      "[data-urn*='urn:li:activity:'], [data-urn*='urn:li:ugcPost:'], [data-urn*='urn:li:share:'], [data-id*='urn:li:activity:'], div.feed-shared-update-v2, [data-view-name='feed-full-update']"
    ),
  ];

  // 2) Layout-independent anchors, one per post:
  //    - "Open control menu for post by <Name>" (new LinkedIn search UI)
  //    - a "Comment" button (older layouts)
  //    Climb from each anchor to the largest ancestor whose anchors all belong to the same post.
  const MENU_RE = /^open control menu for post by\s+/i;
  const anchorKey = (b) => {
    const label = b.getAttribute("aria-label") || "";
    if (MENU_RE.test(label)) return label;
    if (/^comment$/i.test(clean(b.innerText)) || /^comment\b/i.test(label)) return b; // unique per button
    return null;
  };
  let anchors = [...document.querySelectorAll("button, [role='button']")].filter((b) => anchorKey(b) !== null);
  // When posts have ⋯ menus, use only those: a Comment button sits in the same post, and mixing
  // the two cut posts off at the header (body and email ended up outside the captured area)
  if (anchors.some((a) => typeof anchorKey(a) === "string")) anchors = anchors.filter((a) => typeof anchorKey(a) === "string");
  const anchorRoots = anchors.map((btn) => {
    const key = anchorKey(btn);
    let el = btn;
    while (el.parentElement && el.parentElement !== document.body) {
      const keys = new Set(anchors.filter((a) => el.parentElement.contains(a)).map(anchorKey));
      if (keys.size > 1 || !keys.has(key)) break;
      el = el.parentElement;
    }
    return el;
  });

  const all = [...new Set([...known, ...anchorRoots])];
  const roots = all.filter((el) => !all.some((o) => o !== el && o.contains(el))); // outermost only

  // Strip "… more" / "see less" toggles that sit inside the text
  const stripToggles = (t) =>
    t.replace(/\n?\s*(…|\.\.\.)\s*(see )?more\s*$/i, "").replace(/\n?\s*(…\s*)?(see )?less\s*$/i, "").trim();

  // Post body = longest text block that has no header/action controls in it
  const CONTROL_SEL =
    "button[aria-label^='Open control menu' i], button[aria-label*='reaction' i], button[aria-label^='Follow' i], a[href*='/in/'] img, a[href*='/company/'] img";
  const DEGREE_RE = /•\s*(1st|2nd|3rd\+?)\b/;
  // Author block = smallest element holding both the ⋯ menu and the author's profile link
  const headerOf = (root) => {
    const menu = root.querySelector("button[aria-label^='Open control menu for post by' i]");
    const link = root.querySelector("a[href*='/in/'], a[href*='/company/']");
    if (!menu || !link) return null;
    let el = menu.parentElement;
    while (el && el !== root && !el.contains(link)) el = el.parentElement;
    return el && el !== root ? el : null;
  };
  const bodyText = (root) => {
    const preferred = root.querySelector(
      ".update-components-text, .feed-shared-update-v2__description, .feed-shared-inline-show-more-text, [data-view-name='feed-commentary'], [data-testid='expandable-text-box']"
    );
    if (clean(preferred?.innerText)) return stripToggles(clean(preferred.innerText));
    const header = headerOf(root);
    let best = "";
    for (const el of root.querySelectorAll("div, span, p")) {
      if (header && (header.contains(el) || el.contains(header))) continue; // never the author block
      if (el.querySelector(CONTROL_SEL)) continue;
      const followBtn = [...el.querySelectorAll("button")].some((b) => /^follow$/i.test(clean(b.innerText)));
      if (followBtn) continue;
      const t = stripToggles(clean(el.innerText));
      if (DEGREE_RE.test(t.slice(0, 200))) continue; // looks like "Name • 2nd / headline / 3h"
      if (t.length > best.length) best = t;
    }
    return best;
  };

  // Post id can be plain or URL-encoded, or only present in a /posts/...-activity-123 link
  const urnFrom = (str) => {
    const html = str.replace(/%3A/gi, ":");
    const m = html.match(/urn:li:(?:activity|ugcPost|share):\d+/);
    if (m) return m[0];
    const a = html.match(/-activity-(\d{10,})/);
    return a ? `urn:li:activity:${a[1]}` : "";
  };

  // New search UI has no link in the DOM: use the post's ⋯ menu → "Copy link to post"
  const visible = (e) => e.getClientRects().length > 0;
  const copyPostLink = async (post) => {
    const btn = [...post.querySelectorAll("button[aria-label^='Open control menu for post by' i]")].find(visible);
    if (!btn) return "";
    const root = document.documentElement;
    delete root.dataset.lpcCopied;
    root.dataset.lpcCapture = "1";
    try {
      btn.scrollIntoView({ block: "center" });
      btn.click();
      let item = null;
      for (let i = 0; i < 20 && !item; i++) {
        await sleep(100);
        const isCopy = (e) => /^copy link to post$/i.test(clean(e.innerText)) && visible(e);
        item =
          [...document.querySelectorAll("[role='menuitem'], button, [role='button'], a")].find(isCopy) ||
          [...document.querySelectorAll("li, div, span, p")].filter(isCopy).pop(); // deepest match
      }
      if (!item) {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return "";
      }
      item.click();
      for (let i = 0; i < 15 && root.dataset.lpcCopied == null; i++) await sleep(100);
      return root.dataset.lpcCopied || "";
    } finally {
      root.dataset.lpcCapture = "0";
    }
  };

  // Profile/company page without tracking params: https://www.linkedin.com/in/jane-doe/
  const profileUrl = (a) => {
    if (!a?.href) return "";
    const u = new URL(a.href, location.href);
    const m = u.pathname.match(/^\/(in|company|school|showcase)\/[^/]+/);
    return m ? `https://www.linkedin.com${m[0]}/` : "";
  };

  const TIME_RE = /^\d+\s?(s|m|h|d|w|mo|yr|y)\b|\b(minute|hour|day|week|month|year)s? ago/i;
  const SKIP_LINE = /^(•|follow|\+ follow|connect|view profile|premium|promoted|verified|feed post)/i;

  const searchKeyword = new URLSearchParams(location.search).get("keywords") || "";
  const posts = [];
  for (const el of roots) {
    const text = bodyText(el);
    if (text.length < 20) continue;

    let urn = urnFrom(el.outerHTML);
    if (!urn && getLinks) urn = urnFrom(await copyPostLink(el));
    const menuLabel = el.querySelector("button[aria-label^='Open control menu for post by' i]")?.getAttribute("aria-label") || "";
    // Header lines (before the post body): name, headline, time
    const full = clean(el.innerText);
    const header = full.includes(text.slice(0, 40)) ? full.slice(0, full.indexOf(text.slice(0, 40))) : full.slice(0, 400);
    const lines = header
      .split("\n")
      .map(clean)
      .filter((l) => l && !SKIP_LINE.test(l) && !/^(1st|2nd|3rd\+?)$/.test(l) && !/^•\s*(1st|2nd|3rd\+?)$/.test(l));
    const actorLink = el.querySelector("a[href*='/in/'], a[href*='/company/']");
    const author = (
      menuLabel.replace(MENU_RE, "") ||
      clean(el.querySelector(".update-components-actor__title span[aria-hidden='true']")?.innerText) ||
      clean(actorLink?.querySelector("span[aria-hidden='true']")?.innerText) ||
      lines[0] ||
      ""
    )
      .split("\n")[0]
      .replace(/\s*•.*$/, "") // drop "• 2nd" etc.
      .trim();
    const timeLine = lines.find((l) => TIME_RE.test(l)) || "";
    const headline =
      clean(el.querySelector(".update-components-actor__description span[aria-hidden='true']")?.innerText) ||
      lines.find((l) => !l.startsWith(author) && l !== timeLine && !TIME_RE.test(l)) ||
      "";

    posts.push({
      id: urn || undefined,
      url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : "",
      author,
      authorHeadline: headline,
      authorUrl: profileUrl(actorLink),
      postedAt: timeLine.split("•")[0].trim(),
      text,
      searchKeyword,
    });
  }
  return posts;
}

// Summarises the page structure so selectors can be fixed remotely: element names,
// attributes and short text snippets for one post (not the whole page).
function collectDebugInfo() {
  const count = (sel) => document.querySelectorAll(sel).length;
  const buttons = [...document.querySelectorAll("button")].map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim()).filter(Boolean);
  const freq = {};
  for (const t of buttons) freq[t.slice(0, 40)] = (freq[t.slice(0, 40)] || 0) + 1;
  const viewNames = {};
  for (const el of document.querySelectorAll("[data-view-name]")) {
    const v = el.getAttribute("data-view-name");
    viewNames[v] = (viewNames[v] || 0) + 1;
  }
  const MENU = "button[aria-label^='Open control menu for post by' i]";
  const menus = [...document.querySelectorAll(MENU)];
  const sample = menus[0] || [...document.querySelectorAll("button")].find((b) => /comment/i.test(b.innerText || b.getAttribute("aria-label") || ""));
  const attrsOf = (el) =>
    [...el.attributes]
      .filter((a) => /^(class|data-|role|aria-label|dir|href|componentkey|id)/.test(a.name))
      .map((a) => `${a.name}="${a.value.slice(0, 50)}"`)
      .join(" ");
  // Each ancestor of the first ⋯ button: how much text it holds and how many posts' menus
  const ancestors = [];
  let box = sample;
  for (let i = 0; box && box !== document.body && i < 25; i++, box = box.parentElement) {
    const labels = new Set([...box.querySelectorAll(MENU)].map((b) => b.getAttribute("aria-label")));
    ancestors.push(`${i}: <${box.tagName.toLowerCase()} ${attrsOf(box)}> text=${(box.innerText || "").length} menus=${labels.size} links=${box.querySelectorAll("a[href*='/in/'],a[href*='/company/']").length}`);
  }
  // Outermost ancestor that still holds only this post's menu = what the capture treats as the post
  let post = sample;
  const label = sample?.getAttribute("aria-label");
  while (post?.parentElement && post.parentElement !== document.body) {
    const labels = new Set([...post.parentElement.querySelectorAll(MENU)].map((b) => b.getAttribute("aria-label")));
    if (labels.size > 1 || (label && !labels.has(label))) break;
    post = post.parentElement;
  }
  const skeleton = (el, depth = 0) => {
    if (!el || depth > 30) return "";
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").slice(0, 40);
    return `${"  ".repeat(depth)}<${el.tagName.toLowerCase()} ${attrsOf(el)}>${own}\n` + [...el.children].map((c) => skeleton(c, depth + 1)).join("");
  };
  return {
    frameUrl: location.href,
    counts: {
      dataUrnActivity: count("[data-urn*='activity']"),
      feedSharedUpdate: count(".feed-shared-update-v2"),
      updateComponentsText: count(".update-components-text"),
      articles: count("article, [role='article']"),
      listItems: count("li, [role='listitem']"),
    },
    buttonTexts: Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 40),
    viewNames,
    menuButtons: menus.length,
    ancestors,
    postSkeleton: skeleton(post).slice(0, 25000),
  };
}
