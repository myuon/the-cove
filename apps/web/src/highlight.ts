// Finding the line in a species' source that named this tick's reason —
// layer three's one piece of the inspector that reads Cove rather than JSON.
//
// A `Reason` variant is a place in `catalog/contract/contract.cove`'s enum
// and a place in whatever `catalog/species/<id>/creature.cove` constructs it
// at, but the tank hands the page only the variant's name (`fleeing_threat`,
// from `Reason.name()`), not a line number — the runtime that ran the
// decision never recorded where in the source it came from, only what it
// answered. So this is a text search, not a compiler span: it is exactly as
// good as grepping the source for `Reason.FleeingThreat` by hand, and no
// better. The inspector says so in its caption for the same reason this
// comment does.

/** `fleeing_threat` -> `FleeingThreat`, the reverse of `Reason.name()` in
 * `catalog/contract/contract.cove` — every `Reason` variant is one or more
 * `snake_case` words, and this is exactly how that file turns a
 * `PascalCase` variant into one. */
export function reasonToken(reason: string): string {
  return reason
    .split("_")
    .filter((word) => word.length > 0)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join("");
}

/** Every 0-indexed line of `source` that mentions this `reason`'s
 * `Reason.X` constructor — usually exactly one, because a species commits
 * to one reason per branch, but never assumed to be: a species that names
 * the same reason from two branches (`reefGrazer` does, for
 * `Reason.FleeingThreat`) should show a visitor both. */
export function highlightedLines(source: string, reason: string): number[] {
  const needle = `Reason.${reasonToken(reason)}`;
  const lines = source.split("\n");
  const hits: number[] = [];
  lines.forEach((line, index) => {
    if (line.includes(needle)) {
      hits.push(index);
    }
  });
  return hits;
}
