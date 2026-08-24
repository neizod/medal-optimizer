"use strict";

const CATALOG = [
  { alias: "free", file: "sw2402_free.txt" },
  { alias: "urban", file: "pw2412_urban.txt" },
  { alias: "control", file: "pw2507_control.txt" },
  { alias: "dust", file: "pw2509_dust.txt" },
  { alias: "warhammer40k", file: "lw2608_warhammer40k.txt" },
];

const STORAGE_KEY = "helldiver-medal-optimizer.preferences.v1";
const WARBOND_STORAGE_KEY = "helldiver-medal-optimizer.warbond.v1";

const select = document.querySelector("#warbond");
const pagesElement = document.querySelector("#pages");
const statusElement = document.querySelector("#status");
const howToUseButton = document.querySelector("#how-to-use");
const resetButton = document.querySelector("#reset");
const clearButton = document.querySelector("#clear");
const medalTotalElement = document.querySelector("#medal-total");

let currentAlias = readSelectedWarbond();
let currentWarbond = null;
let standardPreferences = new Set();
let selectedPreferences = new Set();
let plannedPurchases = new Set();
const warbondTextCache = new Map();

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
      preferences.add(cardId(page, key));
    }
  }
  return preferences;
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

    const heading = document.createElement("h2");
    heading.textContent = page.number === 1
      ? `Page ${page.number}`
      : `Page ${page.number}, unlock: 💀 ${page.unlock}`;
    section.append(heading);

    const grid = document.createElement("div");
    grid.className = "grid";
    grid.setAttribute("aria-label", `Page ${page.number} rewards`);

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

      const name = document.createElement("span");
      name.textContent = item.fullName === "FIXME" ? item.key : item.fullName;
      const key = document.createElement("small");
      key.className = "key";
      key.textContent = item.key;
      const cost = document.createElement("small");
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
  window.alert(
    "Choose a warbond, then click cards you want to buy. Green cards are your "
    + "choices; yellow cards are extra purchases suggested to unlock later "
    + "pages. Selections are saved automatically. Reset restores the standard "
    + "preferences; Clear removes every selection.",
  );
});
resetButton.addEventListener("click", () => {
  if (window.confirm("Reset this warbond to its standard preferences?")) {
    replaceSelection(standardPreferences);
  }
});
clearButton.addEventListener("click", () => {
  if (window.confirm("Clear every selected card in this warbond?")) {
    replaceSelection([]);
  }
});

function showError(error) {
  statusElement.hidden = false;
  statusElement.textContent = error.message;
}

populateCatalog()
  .then(() => loadWarbond(currentAlias))
  .catch(showError);
