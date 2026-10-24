const $ = (id) => document.getElementById(id);
const status = (msg) => ($("status").textContent = msg);

const FIELDS = ["portal", "token", "pages", "links", "keywords", "datePosted", "sortBy", "delay"];

chrome.storage.local.get([...FIELDS, "run"], (s) => {
  // Port 3000 was the old default but is used by another app on this machine
  const saved = s.portal === "http://localhost:3000" ? "" : s.portal;
  $("portal").value = saved || DEFAULT_PORTAL;
  $("token").value = s.token || "";
  if (s.pages != null) $("pages").value = s.pages;
  if (s.links != null) $("links").checked = s.links;
  if (s.keywords != null) $("keywords").value = s.keywords;
  if (s.datePosted != null) $("datePosted").value = s.datePosted;
  if (s.sortBy != null) $("sortBy").value = s.sortBy;
  if (s.delay != null) $("delay").value = s.delay;
  renderRun(s.run);
});

function saveSettings() {
  chrome.storage.local.set({
    portal: portalUrl(),
    token: $("token").value,
    pages: Number($("pages").value),
    links: $("links").checked,
    keywords: $("keywords").value,
    datePosted: $("datePosted").value,
    sortBy: $("sortBy").value,
    delay: Number($("delay").value),
  });
}

function portalUrl() {
  return ($("portal").value.trim() || DEFAULT_PORTAL).replace(/\/+$/, "");
}

function jobSettings() {
  return {
    portal: portalUrl(),
    token: $("token").value,
    pages: Number($("pages").value) || 0,
    links: $("links").checked,
    delaySec: Math.max(5, Number($("delay").value) || 15),
  };
}

// Live progress from the background run
chrome.storage.onChanged.addListener((changes) => {
  if (changes.run) renderRun(changes.run.newValue);
});

function renderRun(run) {
  const running = !!run?.running;
  $("runSearch").disabled = running;
  $("capture").disabled = running;
  $("stop").hidden = !running;
  $("progress").textContent = running
    ? `Running ${run.done}/${run.total}${run.current ? ` — ${run.current}` : ""}`
    : "";
  if (run?.log?.length) {
    status(run.log.join("\n"));
    $("status").scrollTop = $("status").scrollHeight;
  }
}

// localhost is granted in the manifest; any other portal host is requested on first use
async function ensurePortalPermission() {
  const origin = `${new URL(portalUrl()).origin}/*`;
  if (/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(origin)) return;
  if (!(await chrome.permissions.request({ origins: [origin] }))) {
    throw new Error(`Permission to send posts to ${origin} was denied.`);
  }
}

async function start(keywords) {
  saveSettings();
  try {
    await ensurePortalPermission(); // must run first, while the click still counts as a user gesture
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!keywords.length && !tab?.url?.startsWith("https://www.linkedin.com/")) {
      throw new Error("Open a LinkedIn search results page first\n(Search → Posts filter).");
    }
    // Searches reuse the current LinkedIn tab, or open a new one
    if (keywords.length && !tab?.url?.startsWith("https://www.linkedin.com/")) {
      tab = await chrome.tabs.create({ url: "https://www.linkedin.com/feed/", active: true });
    }
    const job = {
      tabId: tab.id,
      keywords,
      filters: { datePosted: $("datePosted").value, sortBy: $("sortBy").value },
      settings: jobSettings(),
    };
    const res = await chrome.runtime.sendMessage({ type: "start", job });
    if (!res?.ok) throw new Error(res?.error || "Could not start.");
    status("Started. You can close this popup — the run continues in the background.");
  } catch (e) {
    status(`Error: ${e.message}`);
  }
}

$("runSearch").onclick = () => {
  const keywords = [...new Set($("keywords").value.split("\n").map((k) => k.trim()).filter(Boolean))];
  if (!keywords.length) return status("Enter at least one keyword.");
  start(keywords);
};

$("capture").onclick = () => start([]);

$("stop").onclick = () => chrome.runtime.sendMessage({ type: "stop" });

$("open").onclick = () => {
  saveSettings();
  chrome.tabs.create({ url: portalUrl() });
};

$("debug").onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith("https://www.linkedin.com/")) throw new Error("Open a LinkedIn page first.");
    const results = await runInTab(tab.id, collectDebugInfo);
    const info = JSON.stringify({ url: tab.url, frames: results }, null, 1);
    await navigator.clipboard.writeText(info);
    status(`Debug info copied (${Math.round(info.length / 1024)} KB). Paste it to the developer.`);
  } catch (e) {
    status(`Error: ${e.message}`);
  }
};
