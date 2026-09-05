// Turning one invocation into plain language — layer one and two of the
// inspector, and the only place this page writes a sentence about a mind it
// did not build.
//
// A sentence built here may name only what `observation` carried: `nearby`,
// `around`, `here`, `scent`. That is the whole of what the creature could
// have reasoned from, and the catalog's own species files
// (`catalog/species/*/creature.cove`) are the ground truth this file is
// translating — `reason` names which branch of which file ran, and the
// table below is one English sentence per branch, not an invention. Cross a
// `reason` with an `intent` this catalog never actually pairs it with and
// `fallbackSentence` is what runs instead: honest about the raw fields
// rather than confidently wrong about their meaning.
//
// A `failure` is not a decision — `crates/simulation/src/world.rs`'s
// `decisions()` answers `Intent::Rest` / `Reason::Waiting` on a creature's
// behalf when its program never finished, and printing "waiting" over that
// would be putting words in a mouth that never opened. So `buildSentence`
// checks it first and returns before the table is ever consulted.

import type {
  CatalogEntry,
  FocusFailure,
  FocusSighting,
  FocusSnapshot,
  Heading,
} from "./snapshot.js";

/** The one or two sentences the inspector's plain-language layer shows. */
export interface Sentence {
  /** What it did, and why — always present. */
  readonly headline: string;
  /** What the world did differently from what was asked, if anything. */
  readonly note: string | null;
}

const HUNTING_ROLES = new Set(["hunter", "ambusher"]);
const PREY_ROLES = new Set(["grazer", "scavenger", "cooperator"]);

function isThreat(sighting: FocusSighting): boolean {
  return HUNTING_ROLES.has(sighting.role);
}

function isPrey(sighting: FocusSighting): boolean {
  return PREY_ROLES.has(sighting.role);
}

/** "a hunter", "an ambusher" — the indefinite article a role's word needs. */
function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

/** "1 step" / "3 steps". */
function steps(away: number): string {
  return `${away} ${away === 1 ? "step" : "steps"}`;
}

/** How much food a level (`0..4`) reads as, in words rather than a count a
 * visitor would have to look up against `renderer.ts`'s colour scale. */
function foodWord(level: number): string {
  if (level <= 0) return "no";
  if (level === 1) return "a little";
  if (level === 2) return "some";
  if (level === 3) return "plenty of";
  return "a lot of";
}

/**
 * A species' catalog name, unless `metSpecies` is given and does not contain
 * it — then its role, because a name for a species a visitor has not
 * encountered is a name that means nothing to them yet.
 *
 * Omitting `metSpecies` (as every caller but this file's own tests does) is
 * "every species met": `main.ts` builds it from every creature that has ever
 * appeared in a snapshot, and the legend already names all four before the
 * first tick renders.
 */
function speciesLabel(
  catalog: readonly CatalogEntry[],
  species: number,
  metSpecies?: ReadonlySet<number>,
): string {
  const entry = catalog[species];
  if (!entry) {
    return "creature";
  }
  if (metSpecies && !metSpecies.has(species)) {
    return entry.role;
  }
  return entry.name;
}

/** What `intent` asks for, parsed the same way `shapes.ts`'s
 * `headingAngleOf` reads a `moved-*` string — but keeping the word rather
 * than converting it to an angle, and covering every intent shape rather
 * than only the ones that carry a heading. */
type Intent =
  | { readonly kind: "move"; readonly heading: Heading }
  | { readonly kind: "eat" }
  | { readonly kind: "hunt"; readonly targetId: number }
  | { readonly kind: "hide" }
  | { readonly kind: "rest" }
  | { readonly kind: "other" };

const HEADINGS: readonly Heading[] = ["north", "east", "south", "west"];

function classifyIntent(intent: string): Intent {
  if (intent === "eat") return { kind: "eat" };
  if (intent === "hide") return { kind: "hide" };
  if (intent === "rest") return { kind: "rest" };
  if (intent.startsWith("hunt-")) {
    const targetId = Number(intent.slice("hunt-".length));
    if (Number.isFinite(targetId)) {
      return { kind: "hunt", targetId };
    }
    return { kind: "other" };
  }
  for (const heading of HEADINGS) {
    if (intent === `move-${heading}`) {
      return { kind: "move", heading };
    }
  }
  return { kind: "other" };
}

/** The sentence for an invocation that never became a `Decision` — see the
 * module comment for why this is checked before anything else. */
function failureSentence(failure: FocusFailure): string {
  switch (failure.kind) {
    case "fuel":
      return "Its program ran out of fuel before it decided, so the world let it rest.";
    case "fault":
      return `Its program broke — ${failure.message}${
        failure.at ? ` at ${failure.at}` : ""
      } — so the world let it rest.`;
    case "malformed":
      return "Its program answered something the world could not read, so the world let it rest.";
    default:
      // `deadline`, `cancelled`, `callDepth`, `hostCalls`, `concurrency`: the
      // other budgets `creature-host::Stopped` names. None of them are ever
      // hit by this catalog today (no deadline is ever set, nothing spawns,
      // nothing recurses deep enough) — this is the honest fallback for a
      // budget the brief did not word a sentence for, using the runtime's
      // own message rather than inventing one that claims more than that.
      return `Its program was stopped — ${failure.message} — so the world let it rest.`;
  }
}

/** A sentence for a `reason`/`intent` pairing this catalog does not
 * actually produce — reachable only if a species changes without this file
 * changing with it. States the raw fields rather than guessing at them. */
function fallbackSentence(focus: FocusSnapshot): string {
  return `${focus.intent}, reasoning ${focus.reason.replace(/_/g, " ")}.`;
}

/** The plain-language headline: what it did, and why. */
function headline(
  focus: FocusSnapshot,
  catalog: readonly CatalogEntry[],
  metSpecies: ReadonlySet<number> | undefined,
): string {
  const intent = classifyIntent(focus.intent);
  const nearby = focus.observation.nearby;

  switch (focus.reason) {
    case "fleeing_threat": {
      const threat = nearby.find(isThreat);
      const who = threat ? withArticle(threat.role) : "something";
      const distance = threat ? steps(threat.away) : "some steps";
      if (intent.kind === "move") {
        return `Ran ${intent.heading} because ${who} was ${distance} away.`;
      }
      if (intent.kind === "hide") {
        return `Hid in the kelp because ${who} was ${distance} away.`;
      }
      if (intent.kind === "rest") {
        return `Had nowhere to go: ${who} ${distance} away and every way out blocked.`;
      }
      return fallbackSentence(focus);
    }

    case "sheltering": {
      if (intent.kind === "hide") {
        return "Hid in the kelp.";
      }
      if (intent.kind === "move") {
        const threat = nearby.find(isThreat);
        const who = threat ? withArticle(threat.role) : "something";
        const distance = threat ? steps(threat.away) : "some steps";
        return `Made for the kelp with ${who} ${distance} away.`;
      }
      return fallbackSentence(focus);
    }

    case "feeding": {
      if (intent.kind === "eat") {
        return `Ate here, where ${foodWord(focus.observation.here)} food was growing.`;
      }
      return fallbackSentence(focus);
    }

    case "seeking_food": {
      if (intent.kind === "move") {
        // `scent` being set is not enough on its own: `shyScavenger.cove`
        // only steps towards it below a species-specific energy this
        // catalog does not expose, and above that line it falls through to
        // the richest patch it can see instead — same as `seeking_food`
        // ever does without a scent at all. Whether that is what happened
        // *this* tick is exactly what comparing the two headings answers,
        // without needing to know the threshold: a move that did not go
        // where the scent pointed was not following it, whatever else is
        // true this tick.
        if (focus.observation.scent === intent.heading) {
          return `Followed the smell of food to the ${intent.heading}.`;
        }
        const patch = focus.observation.around.find(
          (p) => p.heading === intent.heading,
        );
        return `Moved ${intent.heading} towards ${foodWord(patch?.food ?? 0)} food.`;
      }
      return fallbackSentence(focus);
    }

    case "hunting": {
      if (intent.kind === "hunt") {
        const target = nearby.find((s) => s.id === intent.targetId);
        const name = target
          ? speciesLabel(catalog, target.species, metSpecies)
          : "creature";
        const outcome = focus.result.startsWith("hunted-")
          ? ", and caught it."
          : focus.result.startsWith("missed-")
            ? ", and missed."
            : ".";
        return `Lunged at the ${name} one step away${outcome}`;
      }
      if (intent.kind === "move") {
        const prey = nearby.find(isPrey);
        const name = prey
          ? speciesLabel(catalog, prey.species, metSpecies)
          : "something";
        const distance = prey ? steps(prey.away) : "several steps";
        return `Closed on the ${name}, ${distance} away.`;
      }
      return fallbackSentence(focus);
    }

    case "crowded": {
      const closest = nearby[0];
      const name = closest
        ? speciesLabel(catalog, closest.species, metSpecies)
        : "someone";
      if (intent.kind === "move") {
        const distance = closest ? steps(closest.away) : "some steps";
        return `Stepped away from the ${name} ${distance} away.`;
      }
      if (intent.kind === "rest") {
        return `Boxed in, with the ${name} right beside it.`;
      }
      return fallbackSentence(focus);
    }

    case "exploring": {
      if (intent.kind === "move") {
        return `Wandered ${intent.heading} with nothing in sight.`;
      }
      return fallbackSentence(focus);
    }

    case "waiting": {
      if (intent.kind === "rest") {
        return "Waited: nothing to eat and nothing to run from.";
      }
      return fallbackSentence(focus);
    }

    default:
      return fallbackSentence(focus);
  }
}

/** The second sentence: what the world did other than what was asked. `null`
 * whenever it did exactly that — a `hunting` catch or miss is already folded
 * into the headline above, so this never repeats it. */
function note(focus: FocusSnapshot): string | null {
  if (focus.refusal) {
    return `The world refused: ${focus.refusal}.`;
  }
  if (focus.result.startsWith("blocked-")) {
    return "Something was already there.";
  }
  return null;
}

/**
 * The plain-language layer, built only from what `focus` carries — a
 * `reason`, an `intent`, a `result`, and the `observation` that is the whole
 * of what the creature could have reasoned from.
 *
 * `catalog` names a species; `metSpecies`, if given, is which of its indices
 * a visitor has already encountered (every other caller omits it, which
 * this file reads as "all of them" — see `speciesLabel`).
 */
export function buildSentence(
  focus: FocusSnapshot,
  catalog: readonly CatalogEntry[],
  metSpecies?: ReadonlySet<number>,
): Sentence {
  if (focus.failure) {
    // A failure outranks everything: the reason and intent here are the
    // world's stand-in (`Intent::Rest`/`Reason::Waiting`), not the
    // creature's own, so the table above is never consulted for one.
    return { headline: failureSentence(focus.failure), note: null };
  }
  return { headline: headline(focus, catalog, metSpecies), note: note(focus) };
}

/** `reason`, in the visitor's language rather than the identifier
 * `catalog/contract/contract.cove`'s `Reason.name()` writes it as. */
const REASON_WORDS: Readonly<Record<string, string>> = {
  fleeing_threat: "Fleeing a threat",
  seeking_food: "Seeking food",
  feeding: "Feeding",
  sheltering: "Sheltering",
  hunting: "Hunting",
  crowded: "Feeling crowded",
  exploring: "Exploring",
  waiting: "Waiting",
};

/** What a creature is doing, in words — layer two's answer to "what is it
 * doing" alongside its energy and age. Falls back to the raw identifier for
 * a reason this table has not been taught, rather than hiding it. */
export function reasonWord(reason: string): string {
  return REASON_WORDS[reason] ?? reason.replace(/_/g, " ");
}

/**
 * `self.memory` — what the world did with *last* tick's intent, and so the
 * whole of what a creature in this world remembers — in words.
 *
 * Parsed the same way `note` reads `result` above, because `memory` and
 * `result` are the same closed vocabulary (`contract.cove`'s
 * `ActionResult.name()`): whatever a tick's `result` can say, some earlier
 * tick's `memory` can say about itself.
 */
export function memoryWord(memory: string): string {
  if (memory === "spawned") return "It only just arrived.";
  if (memory === "hid") return "It hid, last tick.";
  if (memory === "rested") return "It rested, last tick.";
  if (memory === "refused") {
    return "The world refused what it asked for, last tick.";
  }
  for (const heading of HEADINGS) {
    if (memory === `moved-${heading}`) {
      return `It moved ${heading}, last tick.`;
    }
    if (memory === `blocked-${heading}`) {
      return `It tried to move ${heading}, last tick, and found something in the way.`;
    }
  }
  if (memory.startsWith("ate-")) return "It ate, last tick.";
  if (memory.startsWith("hunted-")) return "It caught something, last tick.";
  if (memory.startsWith("missed-")) {
    return "It lunged at something, last tick, and missed.";
  }
  return memory;
}
