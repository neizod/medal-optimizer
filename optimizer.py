#!/usr/bin/env python3
"""Find the cheapest warbond purchase plan compatible with player preferences."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PAGE_HEADER = re.compile(r"page\s+(\d+)(?:\s+unlock\s+(\d+))?\s*$")
PREF_HEADER = re.compile(r"page\s+(\d+)(?:\s+.*)?$")


class InputError(ValueError):
    """Raised when a warbond or preference file is invalid."""


@dataclass(frozen=True)
class Item:
    name: str
    cost: int


@dataclass(frozen=True)
class Page:
    number: int
    unlock: int
    items: tuple[Item, ...]


@dataclass(frozen=True)
class Purchase:
    item: Item
    requested: bool


def meaningful_lines(path: Path) -> Iterable[tuple[int, str]]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise InputError(f"cannot read {path}: {exc.strerror}") from exc

    for line_number, raw_line in enumerate(text.splitlines(), 1):
        line = raw_line.partition("#")[0].strip()
        if line:
            yield line_number, line


def parse_warbond(path: Path) -> tuple[Page, ...]:
    pages: list[Page] = []
    current_number: int | None = None
    current_unlock = 0
    current_items: list[Item] = []

    def finish_page() -> None:
        nonlocal current_number, current_items
        if current_number is not None:
            pages.append(Page(current_number, current_unlock, tuple(current_items)))
        current_number = None
        current_items = []

    for line_number, line in meaningful_lines(path):
        header = PAGE_HEADER.fullmatch(line)
        if header:
            finish_page()
            current_number = int(header.group(1))
            if header.group(2) is None:
                raise InputError(f"{path}:{line_number}: page header needs an unlock value")
            current_unlock = int(header.group(2))
            continue

        if current_number is None:
            raise InputError(f"{path}:{line_number}: item appears before a page header")
        try:
            name, raw_cost = line.rsplit(maxsplit=1)
            cost = int(raw_cost)
        except (ValueError, TypeError) as exc:
            raise InputError(f"{path}:{line_number}: expected ITEM COST") from exc
        if cost < 0:
            raise InputError(f"{path}:{line_number}: item cost cannot be negative")
        current_items.append(Item(name, cost))

    finish_page()
    if not pages:
        raise InputError(f"{path}: contains no pages")

    expected_numbers = list(range(1, len(pages) + 1))
    actual_numbers = [page.number for page in pages]
    if actual_numbers != expected_numbers:
        raise InputError(f"{path}: pages must be ordered and contiguous from page 1")
    if pages[0].unlock != 0:
        raise InputError(f"{path}: page 1 must have unlock value 0")
    if any(left.unlock > right.unlock for left, right in zip(pages, pages[1:])):
        raise InputError(f"{path}: unlock values must not decrease")
    return tuple(pages)


def parse_preferences(path: Path, pages: tuple[Page, ...]) -> dict[int, tuple[Item, ...]]:
    names_by_page: dict[int, list[str]] = {}
    current_page: int | None = None

    for line_number, line in meaningful_lines(path):
        header = PREF_HEADER.fullmatch(line)
        if header:
            current_page = int(header.group(1))
            if not 1 <= current_page <= len(pages):
                raise InputError(f"{path}:{line_number}: page {current_page} does not exist")
            names_by_page.setdefault(current_page, [])
            continue
        if current_page is None:
            raise InputError(f"{path}:{line_number}: preference appears before a page header")
        names_by_page[current_page].append(line)

    requested: dict[int, tuple[Item, ...]] = {}
    for page_number, names in names_by_page.items():
        page_items = pages[page_number - 1].items
        resolved: list[Item] = []
        seen: set[str] = set()
        for name in names:
            if name in seen:
                raise InputError(f"{path}: duplicate preference {name!r} on page {page_number}")
            seen.add(name)
            matches = [item for item in page_items if item.name == name]
            if not matches:
                raise InputError(f"{path}: unknown item {name!r} on page {page_number}")
            if len(matches) > 1:
                raise InputError(f"{path}: ambiguous item {name!r} on page {page_number}")
            resolved.append(matches[0])
        requested[page_number] = tuple(resolved)
    return requested


def subset_choices(page: Page, required: tuple[Item, ...]) -> dict[int, tuple[Purchase, ...]]:
    required_set = set(required)
    required_purchases = tuple(Purchase(item, True) for item in page.items if item in required_set)
    required_cost = sum(purchase.item.cost for purchase in required_purchases)
    choices: dict[int, tuple[Purchase, ...]] = {required_cost: required_purchases}

    for item in page.items:
        if item in required_set:
            continue
        purchase = Purchase(item, False)
        additions = {
            cost + item.cost: purchases + (purchase,)
            for cost, purchases in choices.items()
        }
        for cost, purchases in additions.items():
            choices.setdefault(cost, purchases)
    return choices


def optimize(
    pages: tuple[Page, ...], requested: dict[int, tuple[Item, ...]], target_page: int
) -> tuple[tuple[Purchase, ...], ...]:
    # A state retains one representative plan for every reachable cumulative
    # spend. Keeping overshoots is essential because they carry into later pages.
    states: dict[int, tuple[tuple[Purchase, ...], ...]] = {0: ()}

    for page in pages[: target_page - 1]:
        states = {cost: plan for cost, plan in states.items() if cost >= page.unlock}
        if not states:
            raise InputError(f"page {page.number} cannot be unlocked")

        choices = subset_choices(page, requested.get(page.number, ()))
        next_states: dict[int, tuple[tuple[Purchase, ...], ...]] = {}
        for total, plan in states.items():
            for page_cost, purchases in choices.items():
                next_states.setdefault(total + page_cost, plan + (purchases,))
        states = next_states

    target = pages[target_page - 1]
    states = {cost: plan for cost, plan in states.items() if cost >= target.unlock}
    if not states:
        raise InputError(
            f"cannot reach the {target.unlock}-medal threshold for page {target_page}"
        )

    final_purchases = tuple(
        Purchase(item, True) for item in target.items if item in set(requested.get(target_page, ()))
    )
    prior_cost, prior_plan = min(states.items(), key=lambda state: state[0])
    del prior_cost
    return prior_plan + (final_purchases,)


def find_warbond(root: Path, alias: str) -> Path:
    if not alias or Path(alias).name != alias:
        raise InputError(f"invalid warbond abbreviation: {alias!r}")
    matches = sorted((root / "warbonds").glob(f"*_{alias}.txt"))
    if not matches:
        raise InputError(f"unknown warbond: {alias!r}")
    if len(matches) > 1:
        raise InputError(f"warbond abbreviation {alias!r} is ambiguous")
    return matches[0]


def print_plan(alias: str, plan: tuple[tuple[Purchase, ...], ...]) -> None:
    total = 0
    print(f"Warbond: {alias}")
    for page_number, purchases in enumerate(plan, 1):
        page_cost = sum(purchase.item.cost for purchase in purchases)
        total += page_cost
        print(f"page {page_number}: {page_cost} medals (cumulative: {total})")
        for purchase in purchases:
            reason = "requested" if purchase.requested else "unlock"
            print(f"  {purchase.item.name:<12} {purchase.item.cost:>3}  [{reason}]")
    print(f"total: {total} medals")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Find the cheapest purchases satisfying warbond preferences."
    )
    parser.add_argument("warbond", help="warbond abbreviation, such as 'control'")
    parser.add_argument(
        "preference",
        nargs="?",
        type=Path,
        help="alternative preference file (defaults to the matching file in prefs/)",
    )
    parser.add_argument(
        "--no-pref",
        action="store_true",
        help="ignore preferences and find the cheapest way to unlock the last page",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.no_pref and args.preference is not None:
        parser.error("--no-pref cannot be combined with a preference file")

    root = Path(__file__).resolve().parent
    try:
        warbond_path = find_warbond(root, args.warbond)
        pages = parse_warbond(warbond_path)
        if args.no_pref:
            requested: dict[int, tuple[Item, ...]] = {}
            target_page = len(pages)
        else:
            preference_path = args.preference or root / "prefs" / warbond_path.name
            requested = parse_preferences(preference_path, pages)
            if not any(requested.values()):
                raise InputError(f"{preference_path}: contains no requested items")
            target_page = max(page for page, items in requested.items() if items)
        plan = optimize(pages, requested, target_page)
    except InputError as exc:
        parser.error(str(exc))

    print_plan(args.warbond, plan)


if __name__ == "__main__":
    main()
