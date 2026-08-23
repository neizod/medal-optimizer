# Helldiver Medal Optimizer

This repository is the starting point for a Python dynamic-programming optimizer
for spending medals on Helldivers 2 warbond rewards.

## Current contents

- `warbonds/pw2507_control.txt` — sample warbond data with three pages.
- `prefs/pw2507_control.txt` — example rewards the player wants from that
  warbond.
- `optimizer.py` — executable Python 3 command-line optimizer.
- `README.md` — project handoff and initial design notes.

Warbond and preference files with the same basename belong together.

## Usage

List available warbonds by invoking the script without arguments:

```console
./optimizer.py
```

Use the default preferences associated with a warbond:

```console
./optimizer.py control
```

If the warbond has no matching file in `prefs/`, the script automatically finds
the cheapest way to unlock all pages, as if `-z` had been supplied.

The warbond argument also accepts a unique, case-insensitive prefix, so `con`
selects `control`. An ambiguous prefix produces an error listing its matching
candidates.

Use an alternative preference file:

```console
./optimizer.py control -f path/to/my_preferences.txt
./optimizer.py control --pref path/to/my_preferences.txt
```

Ignore preferences and find the cheapest way to unlock the final page:

```console
./optimizer.py --no-pref control
```

The short form is `./optimizer.py -z control`.

`--no-pref` and an alternative preference file are mutually exclusive. In the
output, an asterisk immediately after an item's cost marks a requested purchase;
unmarked items were selected by the optimizer for unlocking. Per-page and
cumulative medal costs are both shown. When several plans tie for the minimum
cost, the script reports the total number of optimal solutions. Pass a 1-based
solution number as the optional second positional argument to display a
different tied plan:

```console
./optimizer.py control 2
```

Requesting a number outside the reported range produces an error.

## Input format

The sample file is divided into page blocks:

```text
Control Group (2025-07-17)

page 1 unlock 0
  body     45
  card      2
...

page 2 unlock 150
  SC       12
...
```

The first line contains the formal warbond name and its ISO release date. It is
followed by a blank line before the page specification.

The header has the form `page <number> unlock <threshold>`. Each following
non-empty line contains an item name and its medal cost, indented by two spaces
for readability. Item names should be treated as labels; repeated labels such
as `SC` are separate rewards when they occur on different pages. Blank lines
separate pages.

Page 1 is always available. To unlock page `k`, purchases made on pages
`1..k-1` must have a combined cost greater than or equal to page `k`'s unlock
threshold. Overspending is allowed. Purchases on page `k` cannot help unlock
that same page, but after it is unlocked they contribute toward later pages.
The rule applies unchanged to warbonds with more than three pages.

Overspending creates carry-over and is central to the optimization. In the
sample, page 1 can be completed at exactly 150 medals with `adv.gun`, `head`,
and `body`, but no subset of page 2 costs exactly the remaining 170 medals
needed to reach 320. Spending 155 on page 1 instead leaves 165, which page 2
can satisfy exactly with `sentry`, `body`, and `cape`. Therefore a plan that is
locally cheapest at one page boundary can be more expensive overall.

## Optimization model

This is knapsack-like, but page access couples the choices: an item can be bought
only after spending enough on strictly earlier pages. For example, cheap page 1
purchases cannot be skipped in favor of spending most medals on page 2, because
page 2 purchases are unavailable until the page 2 threshold is already met.
A useful DP state will therefore preserve all relevant reachable cumulative
spend totals at each page boundary, not just the cheapest way to unlock the
current page. This lets a modest overshoot on one page reduce otherwise forced
overspending on a later page. Each reward is a 0/1 choice.

### Player preferences

The cheapest route is not necessarily the best route for a particular player.
A player may want a cosmetic item, weapon, or other reward even when buying it
makes the final plan cost more than the unconstrained mathematical optimum. The
optimizer should respect those choices rather than prescribe a universal meta.

A preference file lists required rewards compactly, with one page per line and
comma-separated item names:

```text
page 1: SC
page 2: SC
page 3: SC, back
```

Pages with no required items may be omitted or written explicitly, such as
`page 2:`. A preference file with no requested items behaves like `-z` and
unlocks all pages.

The current preference file therefore requests `SC` on every page and `back`
on page 3. These purchases count normally toward page thresholds and their
overspending carries forward. The objective is to find the least expensive
valid plan containing all requested rewards, choosing only the extra purchases
needed to unlock their pages. The result is thus optimal for the player's
chosen playstyle, even when it costs more than a plan with no preferences.

A practical first implementation could:

1. Parse every reward into a record containing page, name, and cost, while
   preserving input order.
2. Parse and resolve requested rewards from the matching preference file.
3. Process reachable states keyed by total medals spent, recording the best
   selection or predecessor for reconstruction.
4. Allow a reward on page `k` only when purchases from pages `1..k-1` meet that
   page's threshold before the reward is purchased.
5. Reconstruct and print requested and additional rewards separately, along
   with total cost and resulting unlocked pages.

Be careful with purchases that cross an unlock threshold: spending on an earlier
page may unlock a later page for the next purchase, but should not retroactively
make an already-considered transition valid. Tests should cover exact-threshold
spending, duplicate item labels, unused budget, a requested reward on a locked
page, and an unknown or ambiguous requested reward.

## Possible extensions

The initial objective is to minimize total medal spending while including every
requested reward. Future preference files might support priorities such as
optional or weighted requests; the current format represents required purchases
only.

## Suggested project shape

Parsing, optimization, and presentation are kept separate so the DP can be
tested without invoking the CLI. The project layout is:

```text
optimizer.py          # parser, data types, and DP solver
warbonds/             # plain-text warbond definitions
prefs/                # requested rewards, paired by filename
```

The implementation currently uses only the Python standard library.
