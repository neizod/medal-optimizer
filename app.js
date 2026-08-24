"use strict";

const CATALOG = [
  { alias: "free", name: "Helldivers Mobilize", file: "sw2402_free.txt" },
  { alias: "urban", name: "Urban Legends", file: "pw2412_urban.txt" },
  { alias: "control", name: "Control Group", file: "pw2507_control.txt" },
  { alias: "dust", name: "Dust Devils", file: "pw2509_dust.txt" },
  { alias: "warhammer40k", name: "Castellan's Creed", file: "lw2608_warhammer40k.txt" },
];

const STORAGE_KEY = "helldiver-medal-optimizer.preferences.v1";
const WARBOND_STORAGE_KEY = "helldiver-medal-optimizer.warbond.v1";

const select = document.querySelector("#warbond");
const pagesElement = document.querySelector("#pages");
const statusElement = document.querySelector("#status");
const resetButton = document.querySelector("#reset");
const clearButton = document.querySelector("#clear");

let currentAlias = readSelectedWarbond();
let currentWarbond = null;
let standardPreferences = new Set();
let selectedPreferences = new Set();

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

    const item = line.match(/^(\S+)\s+(\d+)\s+(\d+x\d+)\s+(.+)$/);
    if (!page || !item) {
      throw new Error(`Invalid warbond line: ${line}`);
    }
    const [width, height] = item[3].split("x").map(Number);
    page.items.push({
      key: item[1],
      cost: Number(item[2]),
      width,
      height,
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
      preferences.add(itemId(page, key));
    }
  }
  return preferences;
}

function itemId(page, key) {
  return `${page}:${key}`;
}

function readStoredPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
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
  const response = await fetch(path);
  if (optional && response.status === 404) {
    return "";
  }
  if (!response.ok) {
    throw new Error(`Could not load ${path} (${response.status})`);
  }
  return response.text();
}

async function loadWarbond(alias) {
  if (location.protocol === "file:") {
    throw new Error(
      "Serve this directory over HTTP: python3 -m http.server 8000",
    );
  }

  const entry = CATALOG.find((candidate) => candidate.alias === alias);
  if (!entry) {
    throw new Error(`Unknown warbond: ${alias}`);
  }

  statusElement.hidden = false;
  statusElement.textContent = "Loading warbond data…";
  pagesElement.replaceChildren();

  const [warbondText, preferenceText] = await Promise.all([
    fetchText(`warbonds/${entry.file}`),
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

  for (const page of currentWarbond.pages) {
    const section = document.createElement("section");
    section.className = "page";

    const heading = document.createElement("h2");
    heading.textContent = page.number === 1
      ? `Page ${page.number}`
      : `Page ${page.number}, unlock: ${page.unlock}`;
    section.append(heading);

    const grid = document.createElement("div");
    grid.className = "grid";
    grid.setAttribute("aria-label", `Page ${page.number} rewards`);

    const items = [...page.items].sort(
      (left, right) => (right.width * right.height) - (left.width * left.height),
    );
    for (const item of items) {
      const id = itemId(page.number, item.key);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reward";
      button.style.gridColumn = `span ${item.width}`;
      button.style.gridRow = `span ${item.height}`;
      button.dataset.itemId = id;
      button.setAttribute("aria-pressed", selectedPreferences.has(id));

      const name = document.createElement("span");
      name.textContent = item.fullName === "FIXME" ? item.key : item.fullName;
      const cost = document.createElement("small");
      cost.textContent = `${item.cost} medals`;
      button.append(name, cost);

      button.addEventListener("click", () => {
        if (selectedPreferences.has(id)) {
          selectedPreferences.delete(id);
        } else {
          selectedPreferences.add(id);
        }
        button.setAttribute("aria-pressed", selectedPreferences.has(id));
        savePreferences();
      });
      grid.append(button);
    }

    section.append(grid);
    pagesElement.append(section);
  }
}

function replaceSelection(preferences) {
  selectedPreferences = new Set(preferences);
  savePreferences();
  renderPages();
}

function populateCatalog() {
  for (const entry of CATALOG) {
    const option = document.createElement("option");
    option.value = entry.alias;
    option.textContent = `${entry.name} (${entry.alias})`;
    option.selected = entry.alias === currentAlias;
    select.append(option);
  }
}

select.addEventListener("change", () => {
  loadWarbond(select.value).catch(showError);
});
resetButton.addEventListener("click", () => replaceSelection(standardPreferences));
clearButton.addEventListener("click", () => replaceSelection([]));

function showError(error) {
  statusElement.hidden = false;
  statusElement.textContent = error.message;
}

populateCatalog();
loadWarbond(currentAlias).catch(showError);
