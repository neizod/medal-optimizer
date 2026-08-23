#!/usr/bin/env python3
"""Find the cheapest warbond purchase plan compatible with player preferences."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Iterable


PAGE_HEADER = re.compile(r"page\s+(\d+)(?:\s+unlock\s+(\d+))?\s*$")
PREF_LINE = re.compile(r"page\s+(\d+)\s*:\s*(.*)$")
WARBOND_HEADER = re.compile(r"(.+?)\s+\((\d{4}-\d{2}-\d{2})\)\s*$")


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
class Warbond:
    title: str
    release_date: date
    pages: tuple[Page, ...]


@dataclass(frozen=True)
class Purchase:
    item: Item
    requested: bool


@dataclass
class PlanNode:
    count: int = 0
    edges: list[PlanEdge] = field(default_factory=list)


@dataclass(frozen=True)
class PlanEdge:
    previous: PlanNode
    purchases: tuple[Purchase, ...]


@dataclass(frozen=True)
class WarbondRef:
    alias: str
    path: Path


def meaningful_lines(path: Path) -> Iterable[tuple[int, str]]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise InputError(f"cannot read {path}: {exc.strerror}") from exc

    for line_number, raw_line in enumerate(text.splitlines(), 1):
        line = raw_line.partition("#")[0].strip()
        if line:
            yield line_number, line


def parse_warbond(path: Path) -> Warbond:
    lines = iter(meaningful_lines(path))
    try:
        header_line_number, header_line = next(lines)
    except StopIteration as exc:
        raise InputError(f"{path}: is empty") from exc

    header = WARBOND_HEADER.fullmatch(header_line)
    if not header:
        raise InputError(
            f"{path}:{header_line_number}: expected WARBOND NAME (YYYY-MM-DD)"
        )
    title = header.group(1)
    try:
        release_date = date.fromisoformat(header.group(2))
    except ValueError as exc:
        raise InputError(f"{path}:{header_line_number}: invalid release date") from exc

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

    for line_number, line in lines:
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
    return Warbond(title, release_date, tuple(pages))


def parse_preferences(path: Path, pages: tuple[Page, ...]) -> dict[int, tuple[Item, ...]]:
    names_by_page: dict[int, list[str]] = {}

    for line_number, line in meaningful_lines(path):
        match = PREF_LINE.fullmatch(line)
        if not match:
            raise InputError(
                f"{path}:{line_number}: expected page NUMBER: ITEM, ITEM, ..."
            )
        page_number = int(match.group(1))
        if not 1 <= page_number <= len(pages):
            raise InputError(f"{path}:{line_number}: page {page_number} does not exist")
        if page_number in names_by_page:
            raise InputError(f"{path}:{line_number}: duplicate page {page_number}")

        raw_names = match.group(2).strip()
        names = [] if not raw_names else [name.strip() for name in raw_names.split(",")]
        if any(not name for name in names):
            raise InputError(f"{path}:{line_number}: item names cannot be empty")
        names_by_page[page_number] = names

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


def subset_choices(
    page: Page, required: tuple[Item, ...]
) -> list[tuple[int, tuple[Purchase, ...]]]:
    required_set = set(required)
    required_purchases = tuple(Purchase(item, True) for item in page.items if item in required_set)
    required_cost = sum(purchase.item.cost for purchase in required_purchases)
    choices = [(required_cost, required_purchases)]

    for item in page.items:
        if item in required_set:
            continue
        purchase = Purchase(item, False)
        choices += [
            (cost + item.cost, purchases + (purchase,))
            for cost, purchases in choices
        ]
    return choices


def unrank_plan(node: PlanNode, solution_number: int) -> tuple[tuple[Purchase, ...], ...]:
    if not node.edges:
        return ()
    for edge in node.edges:
        if solution_number > edge.previous.count:
            solution_number -= edge.previous.count
            continue
        return unrank_plan(edge.previous, solution_number) + (edge.purchases,)
    raise AssertionError("solution number exceeds the DP node count")


def optimize(
    pages: tuple[Page, ...],
    requested: dict[int, tuple[Item, ...]],
    target_page: int,
    solution_number: int,
) -> tuple[tuple[tuple[Purchase, ...], ...], int]:
    # Each cumulative-spend state is a compact DAG node. Its count supports
    # selecting any tied solution without materializing every complete plan.
    states = {0: PlanNode(count=1)}

    for page in pages[: target_page - 1]:
        states = {cost: state for cost, state in states.items() if cost >= page.unlock}
        if not states:
            raise InputError(f"page {page.number} cannot be unlocked")

        choices = subset_choices(page, requested.get(page.number, ()))
        next_states: dict[int, PlanNode] = {}
        for total, previous in states.items():
            for page_cost, purchases in choices:
                next_cost = total + page_cost
                node = next_states.setdefault(next_cost, PlanNode())
                node.count += previous.count
                node.edges.append(PlanEdge(previous, purchases))
        states = next_states

    target = pages[target_page - 1]
    states = {cost: state for cost, state in states.items() if cost >= target.unlock}
    if not states:
        raise InputError(
            f"cannot reach the {target.unlock}-medal threshold for page {target_page}"
        )

    final_purchases = tuple(
        Purchase(item, True) for item in target.items if item in set(requested.get(target_page, ()))
    )
    minimum_cost = min(states)
    optimum = states[minimum_cost]
    if solution_number > optimum.count:
        raise InputError(
            f"solution {solution_number} does not exist; choose 1 through {optimum.count}"
        )
    return unrank_plan(optimum, solution_number) + (final_purchases,), optimum.count


def available_warbonds(root: Path) -> tuple[WarbondRef, ...]:
    refs: list[WarbondRef] = []
    for path in sorted((root / "warbonds").glob("*.txt")):
        _, separator, alias = path.stem.partition("_")
        if separator and alias:
            refs.append(WarbondRef(alias, path))
    return tuple(refs)


def format_warbonds(refs: Iterable[WarbondRef]) -> str:
    lines = ["Available warbonds:"]
    entries = list(refs)
    if not entries:
        lines.append("  (none)")
    else:
        lines.extend(f"  {ref.alias:<16} {ref.path.name}" for ref in entries)
    return "\n".join(lines)


def find_warbond(refs: tuple[WarbondRef, ...], query: str) -> WarbondRef:
    if not query or Path(query).name != query:
        raise InputError(f"invalid warbond abbreviation: {query!r}")

    folded_query = query.casefold()
    exact = [ref for ref in refs if ref.alias.casefold() == folded_query]
    matches = exact or [ref for ref in refs if ref.alias.casefold().startswith(folded_query)]
    if not matches:
        raise InputError(f"unknown warbond: {query!r}\n{format_warbonds(refs)}")
    if len(matches) > 1:
        raise InputError(
            f"warbond abbreviation {query!r} is ambiguous\n{format_warbonds(matches)}"
        )
    return matches[0]


def print_plan(
    warbond: Warbond,
    plan: tuple[tuple[Purchase, ...], ...],
    solution_number: int,
    solution_count: int,
    objective: str,
) -> None:
    total = 0
    heading = f"{warbond.title} ({warbond.release_date.isoformat()})"
    print(heading)
    print("=" * len(heading))
    print()
    print(f"Optimized medal spending for {objective}.")
    print(f"Showing solution {solution_number} of {solution_count}")
    print()
    for page_number, purchases in enumerate(plan, 1):
        page_cost = sum(purchase.item.cost for purchase in purchases)
        total += page_cost
        print(f"page {page_number}: {page_cost} medals (cumulative: {total})")
        for purchase in purchases:
            marker = "*" if purchase.requested else ""
            print(f"  {purchase.item.name:<12} {purchase.item.cost:>3}{marker}")
        print()
    print(f"total: {total} medals")


def positive_integer(value: str) -> int:
    try:
        number = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a positive integer") from exc
    if number < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Find the cheapest purchases satisfying warbond preferences."
    )
    parser.add_argument(
        "warbond",
        nargs="?",
        help="warbond abbreviation or unique prefix, such as 'control' or 'con'",
    )
    parser.add_argument(
        "solution",
        nargs="?",
        type=positive_integer,
        default=1,
        help="1-based optimal solution number to display (default: 1)",
    )
    parser.add_argument(
        "-f",
        "--pref",
        dest="preference",
        type=Path,
        help="alternative preference file (defaults to the matching file in prefs/)",
    )
    parser.add_argument(
        "-z",
        "--no-pref",
        action="store_true",
        help="ignore preferences and find the cheapest way to unlock the last page",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_intermixed_args()
    if args.no_pref and args.preference is not None:
        parser.error("--no-pref cannot be combined with a preference file")

    root = Path(__file__).resolve().parent
    refs = available_warbonds(root)
    if args.warbond is None:
        if args.no_pref or args.preference is not None:
            parser.error("a warbond is required when using options")
        print(format_warbonds(refs))
        return

    try:
        warbond = find_warbond(refs, args.warbond)
        warbond_data = parse_warbond(warbond.path)
        pages = warbond_data.pages
        default_preference = root / "prefs" / warbond.path.name
        use_no_preferences = args.no_pref or (
            args.preference is None and not default_preference.is_file()
        )
        if use_no_preferences:
            requested: dict[int, tuple[Item, ...]] = {}
            target_page = len(pages)
            objective = "unlocking all pages"
        else:
            preference_path = args.preference or default_preference
            requested = parse_preferences(preference_path, pages)
            if any(requested.values()):
                target_page = max(page for page, items in requested.items() if items)
                if args.preference is None:
                    objective = "the standard preferences"
                else:
                    objective = f'personal preferences from "{args.preference}"'
            else:
                target_page = len(pages)
                objective = "unlocking all pages"
        plan, solution_count = optimize(
            pages, requested, target_page, args.solution
        )
    except InputError as exc:
        parser.error(str(exc))

    print_plan(warbond_data, plan, args.solution, solution_count, objective)


if __name__ == "__main__":
    main()
