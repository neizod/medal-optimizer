"use strict";

function cardId(pageNumber, key) {
  return `${pageNumber}:${key}`;
}

function pageChoices(page, requiredCards) {
  const required = page.items.filter((item) =>
    requiredCards.has(cardId(page.number, item.key)));
  const optional = page.items.filter((item) =>
    !requiredCards.has(cardId(page.number, item.key)));
  const requiredCost = required.reduce((total, item) => total + item.cost, 0);
  const choices = [{
    cost: requiredCost,
    cards: required.map((item) => cardId(page.number, item.key)),
  }];

  for (const item of optional) {
    const id = cardId(page.number, item.key);
    const additions = choices.map((choice) => ({
      cost: choice.cost + item.cost,
      cards: [...choice.cards, id],
    }));
    choices.push(...additions);
  }
  return choices;
}

function planPurchases(warbond, requiredCards) {
  const targetIndex = warbond.pages.reduce((deepest, page, index) => (
    page.items.some((item) => requiredCards.has(cardId(page.number, item.key)))
      ? index
      : deepest
  ), -1);
  if (targetIndex < 0) {
    return new Set();
  }

  const root = { previous: null, cards: [] };
  let states = new Map([[0, root]]);

  for (const page of warbond.pages.slice(0, targetIndex)) {
    states = new Map([...states].filter(([total]) => total >= page.unlock));
    if (states.size === 0) {
      throw new Error(`Page ${page.number} cannot be unlocked`);
    }

    const nextStates = new Map();
    for (const [total, previous] of states) {
      for (const choice of pageChoices(page, requiredCards)) {
        const nextTotal = total + choice.cost;
        if (!nextStates.has(nextTotal)) {
          nextStates.set(nextTotal, { previous, cards: choice.cards });
        }
      }
    }
    states = nextStates;
  }

  const target = warbond.pages[targetIndex];
  states = new Map([...states].filter(([total]) => total >= target.unlock));
  if (states.size === 0) {
    throw new Error(
      `Cannot reach the ${target.unlock}-medal threshold for page ${target.number}`,
    );
  }

  const minimum = Math.min(...states.keys());
  const plan = new Set();
  let node = states.get(minimum);
  while (node.previous !== null) {
    node.cards.forEach((id) => plan.add(id));
    node = node.previous;
  }
  target.items
    .filter((item) => requiredCards.has(cardId(target.number, item.key)))
    .forEach((item) => plan.add(cardId(target.number, item.key)));
  return plan;
}

if (typeof module !== "undefined") {
  module.exports = { cardId, planPurchases };
}
