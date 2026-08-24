# Helldiver Medal Optimizer

An exact dynamic-programming optimizer for spending medals in Helldivers 2
warbonds. It finds the cheapest purchase plan that includes the rewards you
personally want; it does not assume that the mathematically cheapest rewards
are the rewards you should prefer.

The project uses readable plain-text data files and only the Python standard
library. Python 3.10 or newer is required.

## Web interface

The repository includes a framework-free web interface. Because it loads the
warbond and preference files with `fetch`, serve the repository over HTTP
instead of opening `index.html` directly:

```console
./launch-server
```

Then open `http://localhost:8000/`. Opening `index.html` directly through a file
manager is not supported because browsers prevent a `file://` page from fetching
the neighboring data files.

The interface defaults to Helldivers Mobilize, renders each page as a 5×3 grid
using the recorded card dimensions, and stores both the selected warbond and
reward preferences in browser `localStorage`. Each card shows its full name,
compact key, and medal cost. Clicking a card toggles it.
**Reset** restores the standard preference file for the selected warbond, while
**Clear** removes every current selection; both actions require confirmation.
The fixed toolbar also provides brief usage help and a live `💀` total for the
selected cards. The web interface does not run the medal optimizer yet.

## Warbond catalog

| Alias | Warbond | Released | Pages |
| --- | --- | --- | ---: |
| `free` | Helldivers Mobilize | 2024-02-08 | 10 |
| `urban` | Urban Legends | 2024-12-13 | 3 |
| `control` | Control Group | 2025-07-17 | 3 |
| `dust` | Dust Devils | 2025-09-04 | 3 |
| `warhammer40k` | Castellan's Creed | 2026-08-12 | 3 |

Run the script without arguments to list the aliases discovered from the
current `warbonds/` directory:

```console
./optimizer.py
```

## Usage

Use a warbond's standard preference file:

```console
./optimizer.py control
```

Aliases accept a unique, case-insensitive prefix, so this is equivalent:

```console
./optimizer.py con
```

An ambiguous prefix produces an error with the matching candidates. An unknown
alias produces an error followed by the full catalog.

Use a personal preference file with either spelling of the option:

```console
./optimizer.py control -f path/to/my-pref.txt
./optimizer.py control --pref path/to/my-pref.txt
```

Ignore preferences and find the cheapest way to unlock the last page:

```console
./optimizer.py -z control
./optimizer.py --no-pref control
```

`-z/--no-pref` and `-f/--pref` are mutually exclusive. If no matching standard
preference file exists, or if that file requests no items, the script behaves
as if `-z` were supplied.

Several distinct plans can have the same minimum cost. The output reports how
many optimal solutions exist and displays solution 1 by default. Select another
with the optional second positional argument:

```console
./optimizer.py control 2
./optimizer.py control 2 -f path/to/my-pref.txt
```

Solution numbers are 1-based. A nonpositive or out-of-range number is an error.
Options and positional arguments may be intermixed.

## Output

A result resembles:

```text
Control Group (2025-07-17)
==========================

Optimized medal spending for the standard preferences.
Showing solution 1 of 4

page 1: 162 medals (cumulative: 162)
  SC             7*
  body          45
  1st.gun       35
  adv.gun       75

...

total: 463 medals
```

An asterisk immediately after a cost marks a requested reward. Unmarked rewards
are additional purchases selected to satisfy page-unlock thresholds. Page
totals show both the medals spent on that page and cumulative spending.

## Warbond data

Files in `warbonds/` use the name `<sorting-prefix>_<alias>.txt`. The sorting
prefix keeps releases ordered in directory listings; only the suffix after the
first underscore is used as the CLI alias.

Each file begins with its formal name and ISO release date, followed by ordered
page blocks:

```text
Control Group (2025-07-17)

page 1 unlock 0
  body      45  1x1  FIXME
  card       2  1x1  FIXME
  1st.gun   35  1x1  FIXME

page 2 unlock 150
  SC        12  1x1  FIXME
  head      45  1x1  FIXME
```

Page headers use `page <number> unlock <threshold>`. Item rows use four fields:

```text
<key> <cost> <box-dimension> <full-name>
```

- `key` is the compact identifier used by preference files and CLI output.
- `cost` is a nonnegative medal cost.
- `box-dimension` uses `WIDTHxHEIGHT`, such as `1x1` or `2x1`, for a future
  grid-based interface.
- `full-name` is the display name. It consumes the rest of the line, so spaces
  are allowed without quotes.

Unfinished catalog entries use `1x1` and `FIXME` as placeholders until their
layout and display names are recorded. Two-space indentation is used for
readability. Pages must be contiguous and ordered from page 1, whose threshold
must be zero. Thresholds cannot decrease. Blank lines are decorative,
surrounding whitespace is ignored, and `#` begins a comment.

An item is uniquely identified by its warbond, page, and key together. A key is
not globally unique: labels such as `SC` intentionally recur across pages and
warbonds. Within one page, duplicate keys make a preference ambiguous and are
therefore unusable as preference targets.

Cards must be listed in visual reading order: left to right, then top to bottom.
The web interface places each card into the first unoccupied grid position where
its complete rectangle fits. A page is invalid if a card cannot fit within the
5×3 grid in that order.

## Preference data

A standard preference file in `prefs/` is paired with its warbond by identical
filename. Personal files supplied with `-f/--pref` use the same compact format:

```text
page 1: SC
page 2: SC, boost
page 3: SC, back
```

Each line lists required rewards for one page. Page lines may appear only once.
Unknown, duplicated, or ambiguous item labels are errors. Empty pages may be
omitted or written explicitly as `page 2:`. A missing or entirely empty
standard preference—or one containing only empty page declarations—means that
no rewards are mandatory and the optimizer will unlock all pages.

When preferences are present, the optimizer unlocks as far as the deepest page
containing a requested reward, buys every requested reward, and minimizes all
additional purchases needed along the way.

## Unlock rules

Page 1 is free. Page `k` becomes available only when purchases from pages
`1..k-1` have a combined cost greater than or equal to page `k`'s threshold.
Purchases on page `k` cannot help unlock that same page, but they contribute
toward every later page.

Overspending carries forward. This makes a greedy page-by-page strategy
incorrect. In Control Group, page 1 can reach exactly 150 medals, but page 2 has
no subset costing the remaining 170 needed for page 3's 320-medal threshold.
Spending 155 on page 1 instead permits an exact 165-medal page 2 selection and
reaches 320 overall.

## How optimization works

Every reward is a 0/1 choice. For each page, the solver enumerates that page's
valid subsets and advances dynamic-programming states keyed by cumulative medal
spending. It retains every reachable total rather than only the cheapest current
unlock, preserving useful overspending for later pages.

Paths that reach the same cumulative total share a compact predecessor DAG.
Each node records its number of incoming optimal plans, allowing the program to
count—and retrieve by number—even billions of tied solutions without storing
every complete plan separately.

Runtime is driven mainly by the number of items on an individual page and the
number of reachable cumulative totals, rather than by the product of every
choice across the entire warbond. The current three-page paid warbonds and
ten-page free warbond complete quickly.

## Project layout

```text
optimizer.py   executable CLI, parsers, DP solver, and output formatting
index.html     web interface document
app.js         warbond loading, grid rendering, and saved preferences
style.css      minimal centered layout and fixed action toolbar
warbonds/      warbond metadata, page layouts, rewards, and medal costs
prefs/         standard player preferences paired by filename
README.md      usage, formats, and algorithm notes
```
