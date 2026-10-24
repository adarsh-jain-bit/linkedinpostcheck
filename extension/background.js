importScripts("capture.js");

// Runs live here (not in the popup) so they keep going when the popup closes.
// Progress is kept in chrome.storage.local.run, which the popup renders.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stopRequested = false;
let active = false; // a run loop is executing in this service worker instance

async function setRun(patch) {
  const { run = {} } = await chrome.storage.local.get("run");
  const next = { ...run, ...patch };
  await chrome.storage.local.set({ run: next });
  return next;
}

async function log(line) {
  const { run = {} } = await chrome.storage.local.get("run");
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  await setRun({ log: [...(run.log || []), `${time}  ${line}`].slice(-60) });
}

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => id === tabId && info.status === "complete" && done();
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// LinkedIn renders results after the page "loads"; wait until posts (or "no results") show up
async function waitForResults(tabId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [{ result } = {}] = await chrome.scripting
      .executeScript({
        target: { tabId },
        func: () => {
          const posts = document.querySelectorAll(
            "button[aria-label^='Open control menu for post by' i], [data-urn*='urn:li:activity:'], div.feed-shared-update-v2"
          ).length;
          if (posts) return posts;
          return /no results found|try shortening or rephrasing/i.test(document.body?.innerText || "") ? -1 : 0;
        },
      })
      .catch(() => []);
    if (result) return result;
    await sleep(1000);
  }
  return 0;
}

async function captureAndSend(tabId, settings, label) {
  const posts = await captureTab(tabId, settings);
  if (!posts.length) {
    await log(`${label}: no posts found`);
    return { found: 0, added: 0 };
  }
  const { added, total } = await sendToPortal(posts, settings);
  await log(`${label}: ${posts.length} posts (${added} new) · portal total ${total}`);
  return { found: posts.length, added };
}

async function run({ tabId, keywords, filters, settings }) {
  stopRequested = false;
  active = true;
  // Extension API calls keep the service worker alive during long waits
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  await chrome.storage.local.set({
    run: { running: true, done: 0, total: keywords.length || 1, current: "", log: [], startedAt: Date.now() },
  });
  let found = 0;
  let added = 0;
  try {
    if (!keywords.length) {
      await setRun({ current: "this page" });
      ({ found, added } = await captureAndSend(tabId, settings, "This page"));
      await setRun({ done: 1 });
      return;
    }
    for (let i = 0; i < keywords.length; i++) {
      if (stopRequested) break;
      const keyword = keywords[i];
      await setRun({ current: keyword });
      try {
        await chrome.tabs.update(tabId, { url: buildSearchUrl(keyword, filters) });
        await waitForTabLoad(tabId);
        const ready = await waitForResults(tabId);
        if (ready === -1) {
          await log(`“${keyword}”: no results on LinkedIn`);
        } else {
          await sleep(1500); // let the first results finish rendering
          const r = await captureAndSend(tabId, settings, `“${keyword}”`);
          found += r.found;
          added += r.added;
        }
      } catch (e) {
        await log(`“${keyword}”: error — ${e.message}`);
        if (/portal/i.test(e.message)) break; // portal down: no point continuing
      }
      await setRun({ done: i + 1 });
      // Pause between searches, with jitter, so the pattern looks less automated
      if (i < keywords.length - 1 && !stopRequested) {
        const wait = settings.delaySec * 1000 * (1 + Math.random() * 0.5);
        await log(`waiting ${Math.round(wait / 1000)}s before next search…`);
        for (const end = Date.now() + wait; Date.now() < end && !stopRequested; ) await sleep(500);
      }
    }
  } catch (e) {
    await log(`Error: ${e.message}`);
  } finally {
    clearInterval(keepAlive);
    active = false;
    await log(`${stopRequested ? "Stopped" : "Finished"}: ${found} posts captured, ${added} new.`);
    await setRun({ running: false, current: "" });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "start") {
    chrome.storage.local.get("run").then(({ run: state }) => {
      if (active && state?.running) return reply({ ok: false, error: "A run is already in progress." });
      run(msg.job);
      reply({ ok: true });
    });
    return true; // async reply
  }
  if (msg.type === "stop") {
    stopRequested = true;
    // If the worker was restarted mid-run, nothing is looping anymore: just clear the flag
    if (!active) setRun({ running: false, current: "" });
    reply({ ok: true });
  }
});

// A run can't survive a browser restart or extension reload; don't leave it marked as running
chrome.runtime.onStartup.addListener(() => setRun({ running: false, current: "" }));
chrome.runtime.onInstalled.addListener(() => setRun({ running: false, current: "" }));
