# Helldiver Medal Optimizer

An exact medal-spending optimizer for Helldivers 2 Warbonds. It finds the
cheapest unlock plan containing the rewards you actually want—not merely the
cheapest rewards available.

The project has no third-party dependencies. The CLI requires Python 3.10+;
the web interface uses plain HTML, CSS, and JavaScript.

## How optimization works

### The constraint

Page 1 is free. To access page `k`, purchases made on pages `1..k-1` must total
at least page `k`'s unlock threshold. An item on page `k` cannot help unlock its
own page, but its cost carries forward toward every later page.

For page `k` with threshold `T[k]`, a partial plan is valid on arrival when

```text
spend(page 1) + ... + spend(page k-1) >= T[k]
```

Every reward is a 0/1 choice: it is bought once or not bought. Wishlist items
are fixed to “bought”; the optimizer chooses among all remaining items.

### Why greedy optimization fails

It is tempting to unlock each page as cheaply as possible, but overspending is
not wasted—it becomes progress toward later pages. A locally cheapest choice
can leave an awkward remainder that the next page's discrete item costs cannot
fill efficiently.

Control Group demonstrates this. Page 2 requires 150 cumulative medals and
page 3 requires 320. Page 1 can reach exactly 150, but page 2 has no subset
costing exactly the remaining 170. If page 1 instead spends 155, page 2 can
contribute exactly 165, reaching 320 with no excess. Spending five more medals
early therefore produces a cheaper complete plan.

This is the key property of the problem: the future cares not only that a page
was unlocked, but exactly how much cumulative overspending reached it.

### Dynamic-programming states

The solver processes pages from left to right. After each page, a state is
identified by one value:

```text
cumulative medals spent so far
```

For each page it first enumerates every valid subset containing that page's
wishlist items. If the current state has total `s` and a page subset costs `c`,
the transition is

```text
DP[next page, s + c] <- DP[current page, s] + chosen subset
```

Before buying from a page, states below that page's unlock threshold are
discarded. Crucially, states above the threshold remain distinct. Collapsing
them into a single “page unlocked” state would erase the carry-over information
that makes the 155-plus-165 plan discoverable.

At the target page, the solver discards totals below its threshold and selects
the smallest surviving total. Requested items on the target page are then
included; no extra target-page purchases are useful because there is no later
page to unlock.

### Tied solutions without storing them all

Different purchase histories often reach the same cumulative total. The CLI
merges those histories into one DP node while retaining predecessor edges. The
result is a compact directed acyclic graph rather than a list of complete plans.

Each node stores the number of plans leading to it. Counts add when transitions
merge, so the final node can report billions of optimal solutions using little
memory. To display solution `n`, the CLI walks backward through predecessor
edges and subtracts their plan counts, effectively unranking one path without
materializing all paths.

### Complexity

If a page has `m` optional items, it contributes up to `2^m` subsets. Those
subsets are combined with the reachable cumulative totals, not with every full
purchase history: histories sharing a total occupy the same state. Runtime is
therefore driven mainly by the largest individual page and the range of
reachable totals. The current three-page paid Warbonds and ten-page free
Warbond finish quickly.

The browser planner uses the same cumulative-spend DP but retains only one
predecessor per total because the UI displays a single recommendation. The CLI
keeps the full predecessor DAG to count and select tied optima.

## Data files

Warbonds live at `warbonds/<sorting-prefix>_<alias>.txt`:

```text
Control Group (2025-07-17)

page 1 unlock 0
  body      45  2x2  AD-26 Bleeding Edge
  card       2  1x2  Conductor of Brilliance
  primary   35  2x1  VG-70 Variable

page 2 unlock 150
  SC        12  1x1  Super Credits
```

Item rows are `<key> <cost> <WIDTHxHEIGHT> <full name>`. The full name consumes
the rest of the line and needs no quotes. Keys need only be unique within their
page; an item is identified by Warbond, page, and key together.

Pages are contiguous from page 1, unlock thresholds never decrease, and page 1
has threshold 0. Cards appear in visual reading order. The web app packs them
into the first available position in a 5×3 grid; an impossible layout produces
an inline page error without hiding later pages. Blank lines are decorative,
and `#` starts a comment.

Standard preferences use the matching filename under `prefs/`. Personal files
passed with `--pref` use the same format:

```text
page 1: SC
page 2: SC, booster
page 3: SC, back
```

Each entry names required item keys. Empty pages may be omitted or written as
`page 2:`. With preferences, optimization stops at the deepest page containing
a requested item; without them, it unlocks the final page.

## Web interface

```console
./launch-server
```

Open <http://localhost:8000/>. Browsers cannot load the neighboring data files
when `index.html` is opened directly through `file://`.

Choose a Warbond and click rewards to wishlist them. Green cards are your
choices, yellow cards are additional purchases recommended by the optimizer,
and gray cards are outside the plan. Selections, collapsed pages, and the
selected Warbond persist in `localStorage`. Hold **Clear** or **Reset** for one
second to activate them.

## CLI

```console
./optimizer.py                         # list available Warbonds
./optimizer.py control                 # use standard preferences
./optimizer.py con                     # unique alias prefixes work
./optimizer.py control 2               # show optimal solution 2
./optimizer.py control -f my-pref.txt  # use personal preferences
./optimizer.py control --pref my-pref.txt
./optimizer.py control -z              # ignore preferences; unlock every page
./optimizer.py control --no-pref
```

`--pref` and `--no-pref` are mutually exclusive. A missing or empty standard
preference behaves like `--no-pref`. Solution numbers are 1-based; the CLI
reports how many equally cheap plans exist.

The catalog currently contains aliases `free`, `urban`, `control`, `dust`, and
`warhammer40k`. The CLI discovers them from `warbonds/*.txt`; run it without
arguments for the authoritative list.

An asterisk in CLI output marks a requested reward. Unmarked rewards were added
only to satisfy unlock thresholds.
