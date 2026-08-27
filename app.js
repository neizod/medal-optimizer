"use strict";

const CATALOG = [
  { alias: "free", file: "sw2402_free.txt" },
  { alias: "control", file: "pw2507_control.txt" },
];

const STORAGE_KEY = "helldiver-medal-optimizer.preferences.v1";
const WARBOND_STORAGE_KEY = "helldiver-medal-optimizer.warbond.v1";
const COLLAPSED_PAGES_STORAGE_KEY = "helldiver-medal-optimizer.collapsed-pages.v1";
const LEGACY_ITEM_KEYS = {
  "1st.gun": "primary",
  "2nd.colt": "secondary",
  "2nd.mlee": "secondary",
  "3rd.bomb": "grenade",
  "adv.gun": "support",
  "adv.rkt": "launcher",
  boost: "booster",
};

const select = document.querySelector("#warbond");
const pagesElement = document.querySelector("#pages");
const statusElement = document.querySelector("#status");
const howToUseButton = document.querySelector("#how-to-use");
const instructionsDialog = document.querySelector("#instructions");
const resetButton = document.querySelector("#reset");
const clearButton = document.querySelector("#clear");
const medalTotalElement = document.querySelector("#medal-total");

let currentAlias = readSelectedWarbond();
let currentWarbond = null;
let standardPreferences = new Set();
let selectedPreferences = new Set();
let plannedPurchases = new Set();
const warbondTextCache = new Map();
const collapsedPages = readCollapsedPages();

function meaningfulLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split("#", 1)[0].trim())
    .filter(Boolean);
}

function parseWarbond(text) {
  const lines = meaningfulLines(text);
  const heading = lines.shift()?.match(/^(.+?)\s+\((\d{4}-\d{2}-\d{2})\)$/);
  if (!heading) {
    throw new Error("Invalid warbond heading");
  }

  const warbond = { title: heading[1], releaseDate: heading[2], pages: [] };
  let page = null;

  for (const line of lines) {
    const pageHeader = line.match(/^page\s+(\d+)\s+unlock\s+(\d+)$/);
    if (pageHeader) {
      page = {
        number: Number(pageHeader[1]),
        unlock: Number(pageHeader[2]),
        items: [],
      };
      warbond.pages.push(page);
      continue;
    }

    const item = line.match(/^(\S+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!page || !item) {
      throw new Error(`Invalid warbond line: ${line}`);
    }
    const dimensions = item[3].match(/^(\d+)x(\d+)$/);
    page.items.push({
      key: item[1],
      cost: Number(item[2]),
      box: item[3],
      width: dimensions ? Number(dimensions[1]) : null,
      height: dimensions ? Number(dimensions[2]) : null,
      fullName: item[4],
    });
  }
  return warbond;
}

function parsePreferences(text) {
  const preferences = new Set();
  for (const line of meaningfulLines(text)) {
    const match = line.match(/^page\s+(\d+)\s*:\s*(.*)$/);
    if (!match) {
      throw new Error(`Invalid preference line: ${line}`);
    }
    const page = Number(match[1]);
    const keys = match[2]
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    for (const key of keys) {
      preferences.add(cardId(page, key));
    }
  }
  return preferences;
}

function readStoredPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    let migrated = false;
    for (const [alias, preferences] of Object.entries(value)) {
      if (!Array.isArray(preferences)) {
        continue;
      }
      value[alias] = preferences.map((id) => {
        if (typeof id !== "string") {
          return id;
        }
        const separator = id.indexOf(":");
        const oldKey = id.slice(separator + 1);
        if (separator < 0 || !Object.hasOwn(LEGACY_ITEM_KEYS, oldKey)) {
          return id;
        }
        migrated = true;
        return `${id.slice(0, separator + 1)}${LEGACY_ITEM_KEYS[oldKey]}`;
      });
    }
    if (migrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    }
    return value;
  } catch {
    return {};
  }
}

function readSelectedWarbond() {
  try {
    const alias = localStorage.getItem(WARBOND_STORAGE_KEY);
    return CATALOG.some((entry) => entry.alias === alias) ? alias : "free";
  } catch {
    return "free";
  }
}

function readCollapsedPages() {
  try {
    const value = JSON.parse(
      localStorage.getItem(COLLAPSED_PAGES_STORAGE_KEY) || "[]",
    );
    return new Map(
      Array.isArray(value)
        ? value.filter((key) => typeof key === "string").map((key) => [key, true])
        : [],
    );
  } catch {
    return new Map();
  }
}

function saveCollapsedPages() {
  try {
    localStorage.setItem(
      COLLAPSED_PAGES_STORAGE_KEY,
      JSON.stringify([...collapsedPages.keys()]),
    );
  } catch {
    // The app still works for this session when storage is unavailable.
  }
}

function saveSelectedWarbond() {
  try {
    localStorage.setItem(WARBOND_STORAGE_KEY, currentAlias);
  } catch {
    // The app still works for this session when storage is unavailable.
  }
}

function savePreferences() {
  const stored = readStoredPreferences();
  stored[currentAlias] = [...selectedPreferences];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

async function fetchText(path, optional = false) {
  if (location.protocol === "file:") {
    throw new Error(
      "Serve this directory over HTTP: python3 -m http.server 8000",
    );
  }
  const response = await fetch(path);
  if (optional && response.status === 404) {
    return "";
  }
  if (!response.ok) {
    throw new Error(`Could not load ${path} (${response.status})`);
  }
  return response.text();
}

function fetchWarbondText(entry) {
  if (!warbondTextCache.has(entry.file)) {
    warbondTextCache.set(entry.file, fetchText(`warbonds/${entry.file}`));
  }
  return warbondTextCache.get(entry.file);
}

async function loadWarbond(alias) {
  const entry = CATALOG.find((candidate) => candidate.alias === alias);
  if (!entry) {
    throw new Error(`Unknown warbond: ${alias}`);
  }

  statusElement.hidden = false;
  statusElement.textContent = "Loading warbond data…";
  pagesElement.replaceChildren();

  const [warbondText, preferenceText] = await Promise.all([
    fetchWarbondText(entry),
    fetchText(`prefs/${entry.file}`, true),
  ]);

  currentAlias = alias;
  saveSelectedWarbond();
  currentWarbond = parseWarbond(warbondText);
  standardPreferences = parsePreferences(preferenceText);

  const stored = readStoredPreferences();
  selectedPreferences = Object.hasOwn(stored, alias)
    ? new Set(stored[alias])
    : new Set(standardPreferences);

  renderPages();
  statusElement.hidden = true;
}

function renderPages() {
  pagesElement.replaceChildren();
  plannedPurchases = planPurchases(currentWarbond, selectedPreferences);

  for (const page of currentWarbond.pages) {
    const section = document.createElement("section");
    section.className = "page";

    const pageHeader = document.createElement("div");
    pageHeader.className = "page-header";

    const heading = document.createElement("h2");
    heading.id = `page-${currentAlias}-${page.number}-heading`;
    heading.textContent = page.number === 1
      ? `Page ${page.number}`
      : `Page ${page.number}, unlock: 💀 ${page.unlock}`;
    pageHeader.append(heading);

    const grid = document.createElement("div");
    grid.className = "grid";
    grid.id = `page-${currentAlias}-${page.number}-grid`;
    grid.setAttribute("aria-label", `Page ${page.number} rewards`);
    const collapseKey = `${currentAlias}:${page.number}`;
    const collapsed = collapsedPages.get(collapseKey) || false;
    section.classList.toggle("collapsed", collapsed);
    grid.hidden = collapsed;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "collapse-toggle";
    toggle.textContent = collapsed ? "Expand" : "Collapse";
    toggle.setAttribute(
      "aria-label",
      `${collapsed ? "Expand" : "Collapse"} Page ${page.number}`,
    );
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-controls", grid.id);
    toggle.addEventListener("click", () => {
      const willCollapse = !grid.hidden;
      grid.hidden = willCollapse;
      section.classList.toggle("collapsed", willCollapse);
      if (willCollapse) {
        collapsedPages.set(collapseKey, true);
      } else {
        collapsedPages.delete(collapseKey);
      }
      saveCollapsedPages();
      toggle.textContent = willCollapse ? "Expand" : "Collapse";
      toggle.setAttribute(
        "aria-label",
        `${willCollapse ? "Expand" : "Collapse"} Page ${page.number}`,
      );
      toggle.setAttribute("aria-expanded", String(!willCollapse));
    });
    pageHeader.append(toggle);
    section.append(pageHeader);

    try {
      for (const { item, x, y } of placeCards(page)) {
        const id = cardId(page.number, item.key);
        const required = selectedPreferences.has(id);
        const suggested = !required && plannedPurchases.has(id);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "reward";
        button.style.gridColumn = `${x + 1} / span ${item.width}`;
        button.style.gridRow = `${y + 1} / span ${item.height}`;
        button.dataset.itemId = id;
        button.dataset.state = required ? "required" : suggested ? "suggested" : "unused";
        button.setAttribute("aria-pressed", required);
        const displayName = item.fullName === "FIXME" ? item.key : item.fullName;
        button.title = item.fullName === "FIXME" ? item.key : item.fullName;
        button.setAttribute(
          "aria-label",
          item.fullName === "FIXME"
            ? `${item.key}, ${item.cost} medals`
            : `${item.fullName}, ${item.key}, ${item.cost} medals`,
        );

        const name = document.createElement("span");
        name.className = "reward-name";
        name.textContent = displayName;
        const key = document.createElement("small");
        key.className = "key";
        key.textContent = item.key;
        const cost = document.createElement("small");
        cost.className = "cost";
        cost.textContent = `💀 ${item.cost}`;
        button.append(name);
        if (item.fullName !== "FIXME") {
          button.append(key);
        }
        button.append(cost);

        button.addEventListener("click", () => {
          if (required) {
            selectedPreferences.delete(id);
          } else {
            selectedPreferences.add(id);
          }
          savePreferences();
          renderPages();
        });
        grid.append(button);
      }
    } catch (error) {
      grid.className = "grid-error";
      grid.setAttribute("role", "alert");
      grid.textContent = `Cannot draw this page: ${error.message}`;
    }

    section.append(grid);
    pagesElement.append(section);
  }
  updateMedalTotal();
}

function updateMedalTotal() {
  const total = currentWarbond.pages.reduce(
    (warbondTotal, page) => warbondTotal + page.items.reduce(
      (pageTotal, item) => pageTotal + (
        plannedPurchases.has(cardId(page.number, item.key)) ? item.cost : 0
      ),
      0,
    ),
    0,
  );
  medalTotalElement.value = `💀 ${total}`;
}

function placeCards(page) {
  const columns = 5;
  const rows = 3;
  const occupied = Array.from({ length: rows }, () => Array(columns).fill(false));
  const placements = [];

  for (const item of page.items) {
    if (!Number.isInteger(item.width) || !Number.isInteger(item.height)
        || item.width < 1 || item.height < 1) {
      throw new Error(
        `card ${item.key} has invalid box dimensions "${item.box}"`,
      );
    }
    let placement = null;
    for (let y = 0; y < rows && !placement; y += 1) {
      for (let x = 0; x < columns && !placement; x += 1) {
        const fits = x + item.width <= columns
          && y + item.height <= rows
          && Array.from({ length: item.height }, (_, dy) =>
            Array.from({ length: item.width }, (_, dx) => !occupied[y + dy][x + dx])
              .every(Boolean))
            .every(Boolean);
        if (fits) {
          placement = { item, x, y };
        }
      }
    }

    if (!placement) {
      throw new Error(
        `Page ${page.number}: card ${item.key} does not fit the 5x3 grid in file order`,
      );
    }

    for (let dy = 0; dy < item.height; dy += 1) {
      for (let dx = 0; dx < item.width; dx += 1) {
        occupied[placement.y + dy][placement.x + dx] = true;
      }
    }
    placements.push(placement);
  }
  return placements;
}

function replaceSelection(preferences) {
  selectedPreferences = new Set(preferences);
  savePreferences();
  renderPages();
}

function expandCurrentWarbondPages() {
  const prefix = `${currentAlias}:`;
  for (const key of collapsedPages.keys()) {
    if (key.startsWith(prefix)) {
      collapsedPages.delete(key);
    }
  }
  saveCollapsedPages();
}

async function populateCatalog() {
  const entries = await Promise.all(CATALOG.map(async (entry) => {
    const warbond = parseWarbond(await fetchWarbondText(entry));
    return { ...entry, title: warbond.title, releaseDate: warbond.releaseDate };
  }));
  entries.sort((left, right) => right.releaseDate.localeCompare(left.releaseDate));

  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.alias;
    option.textContent = `${entry.title} (${entry.releaseDate})`;
    option.selected = entry.alias === currentAlias;
    select.append(option);
  }
}

select.addEventListener("change", () => {
  loadWarbond(select.value).catch(showError);
});
howToUseButton.addEventListener("click", () => {
  instructionsDialog.showModal();
});

function addHoldAction(button, action) {
  let holdTimer = null;
  let holding = false;

  function cancelHold() {
    if (!holding) {
      return;
    }
    window.clearTimeout(holdTimer);
    holdTimer = null;
    holding = false;
    button.classList.remove("holding");
  }

  function startHold(event) {
    if (event.type === "pointerdown" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (holding) {
      return;
    }
    holding = true;
    button.classList.remove("hold-complete");
    button.classList.add("holding");
    holdTimer = window.setTimeout(() => {
      holding = false;
      holdTimer = null;
      button.classList.remove("holding");
      button.classList.add("hold-complete");
      action();
      window.setTimeout(() => button.classList.remove("hold-complete"), 150);
    }, 1000);
  }

  button.addEventListener("pointerdown", startHold);
  button.addEventListener("pointerup", cancelHold);
  button.addEventListener("pointerleave", cancelHold);
  button.addEventListener("pointercancel", cancelHold);
  button.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      startHold(event);
    }
  });
  button.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") {
      cancelHold();
    }
  });
  button.addEventListener("blur", cancelHold);
  button.addEventListener("click", (event) => event.preventDefault());
}

addHoldAction(resetButton, () => {
  expandCurrentWarbondPages();
  replaceSelection(standardPreferences);
});
addHoldAction(clearButton, () => {
  expandCurrentWarbondPages();
  replaceSelection([]);
});

function showError(error) {
  statusElement.hidden = false;
  statusElement.textContent = error.message;
}

populateCatalog()
  .then(() => loadWarbond(currentAlias))
  .catch(showError);
