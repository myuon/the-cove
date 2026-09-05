// Turning one invocation into plain language — layer one and two of the
// inspector, and the only place this page writes a sentence about a mind it
// did not build.
//
// A sentence built here may name only what `observation` carried: `nearby`,
// `food`, `kelp`, `here`. That is the whole of what the creature could have
// reasoned from, and the catalog's own species files
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
//
// # The reef is continuous
//
// There are no cells, no compass headings, and no scent trail any more — a
// creature swims `toward` or `away` from a place, never `move-north`, and it
// senses a mouthful directly rather than smelling upwind of one. So this file
// never names a direction; it names what a creature was moving relative to,
// which is what `nearby`/`food`/`kelp` actually give it, and it names a
// distance as one of four bands — "right beside it" through "at the edge of
// sight" — because "8.43 units away" means nothing to a visitor and a step
// count no longer exists to fall back on.

import type {
  CatalogEntry,
  FocusBed,
  FocusFailure,
  FocusMorsel,
  FocusSighting,
  FocusSnapshot,
} from "./snapshot.js";

/** The one or two sentences the inspector's plain-language layer shows. */
export interface Sentence {
  /** What it did, and why — always present. */
  readonly headline: string;
  /** What the world did differently from what was asked, if anything. */
  readonly note: string | null;
}

/** `contract.cove`'s `Role.hunts()`: the roles a hunt fears fleeing. */
export const HUNTING_ROLES: ReadonlySet<string> = new Set(["hunter", "ambusher"]);
/** `contract.cove`'s `Role.isPrey()`: the roles a hunter chases. */
export const PREY_ROLES: ReadonlySet<string> = new Set([
  "grazer",
  "scavenger",
  "cooperator",
]);

function isThreat(sighting: FocusSighting): boolean {
  return HUNTING_ROLES.has(sighting.role);
}

function isCatchablePrey(sighting: FocusSighting): boolean {
  return PREY_ROLES.has(sighting.role) && !sighting.hidden;
}

/** "a hunter", "an ambusher" — the indefinite article a role's word needs. */
function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

/**
 * A distance in reef units, as a band a visitor can feel rather than a
 * number they would have to calibrate: under ~4 is close enough to reach
 * out and touch, under ~9 is a couple of body lengths, under ~16 is most of
 * what anything on this reef can see across, and past that is the edge of
 * sight for everything but a hunter.
 */
export function band(away: number): string {
  if (away < 4) return "right beside it";
  if (away < 9) return "a length or two away";
  if (away < 16) return "across the water";
  return "at the edge of sight";
}

/** How much food an amount reads as, in words rather than a number a visitor
 * would have to weigh against `MAX_MORSEL` or against how many patches are
 * overlapping underfoot. Shared between a single morsel's `amount` (capped
 * at 4) and `here` (a sum across every morsel a creature is standing in,
 * which is not capped at all) — the boundary between "some" and "plenty of"
 * matters more than which of the two produced the number. */
export function foodWord(amount: number): string {
  if (amount <= 0) return "no";
  if (amount < 1) return "a little";
  if (amount < 3) return "some";
  if (amount < 8) return "plenty of";
  return "a lot of";
}

/**
 * The nearest bed of kelp in an observation — `instinct.cove`'s `shelter()`,
 * re-read off the same array rather than re-derived, since `kelp` already
 * arrives nearest-first.
 */
export function nearestBed(kelp: readonly FocusBed[]): FocusBed | undefined {
  return kelp[0];
}

/**
 * The fullest mouthful in an observation, nearest of those tied —
 * `instinct.cove`'s `richest()`. Not simply `food[0]`: `food` arrives
 * nearest-first, not fullest-first, so this is its own fold the same way the
 * catalog's is.
 */
export function richestMorsel(
  food: readonly FocusMorsel[],
): FocusMorsel | undefined {
  let best: FocusMorsel | undefined;
  for (const morsel of food) {
    if (!best || morsel.amount > best.amount) {
      best = morsel;
    } else if (morsel.amount === best.amount && morsel.away < best.away) {
      best = morsel;
    }
  }
  return best;
}

/** The nearest creature that hunts this one — `instinct.cove`'s
 * `nearest(threats(...))`. */
export function nearestThreat(
  nearby: readonly FocusSighting[],
): FocusSighting | undefined {
  return nearby.find(isThreat);
}

/** The nearest prey a lunge could actually catch — `kelpHunter.cove`'s
 * `nearest(catchable(prey(...)))`: visible, and not hidden in kelp. */
export function nearestCatchablePrey(
  nearby: readonly FocusSighting[],
): FocusSighting | undefined {
  return nearby.find(isCatchablePrey);
}

/**
 * What this creature is reacting to, as a place to draw a line to — the
 * renderer's use of the same observation this file turns into words. `null`
 * whenever the reason has nothing at a distance worth pointing at (`feeding`
 * is happening right where the creature already is).
 */
export function reactionTarget(
  focus: FocusSnapshot,
): { readonly x: number; readonly y: number } | null {
  const nearby = focus.observation.nearby;
  switch (focus.reason) {
    case "fleeing_threat": {
      const threat = nearestThreat(nearby);
      return threat ? { x: threat.x, y: threat.y } : null;
    }
    case "sheltering": {
      if (focus.intent === "hide") {
        const threat = nearestThreat(nearby);
        return threat ? { x: threat.x, y: threat.y } : null;
      }
      const bed = nearestBed(focus.observation.kelp);
      return bed ? { x: bed.x, y: bed.y } : null;
    }
    case "seeking_food": {
      const morsel = richestMorsel(focus.observation.food);
      return morsel ? { x: morsel.x, y: morsel.y } : null;
    }
    case "hunting": {
      if (focus.intent.startsWith("hunt-")) {
        const targetId = Number(focus.intent.slice("hunt-".length));
        const target = nearby.find((s) => s.id === targetId);
        return target ? { x: target.x, y: target.y } : null;
      }
      const prey = nearestCatchablePrey(nearby);
      return prey ? { x: prey.x, y: prey.y } : null;
    }
    case "crowded": {
      const closest = nearby[0];
      return closest ? { x: closest.x, y: closest.y } : null;
    }
    default:
      return null;
  }
}

/** What `intent` asks for, parsed straight off `Intent.name()` in
 * `catalog/contract/contract.cove`: `toward`, `away`, `eat`, `hunt-{id}`,
 * `hide`, `rest` — never a compass direction, because a continuous swim has
 * no cardinal heading. */
type Intent =
  | { readonly kind: "toward" }
  | { readonly kind: "away" }
  | { readonly kind: "eat" }
  | { readonly kind: "hunt"; readonly targetId: number }
  | { readonly kind: "hide" }
  | { readonly kind: "rest" }
  | { readonly kind: "other" };

function classifyIntent(intent: string): Intent {
  if (intent === "toward") return { kind: "toward" };
  if (intent === "away") return { kind: "away" };
  if (intent === "eat") return { kind: "eat" };
  if (intent === "hide") return { kind: "hide" };
  if (intent === "rest") return { kind: "rest" };
  if (intent.startsWith("hunt-")) {
    const targetId = Number(intent.slice("hunt-".length));
    if (Number.isFinite(targetId)) {
      return { kind: "hunt", targetId };
    }
  }
  return { kind: "other" };
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
      // `reefGrazer.cove` and `shyScavenger.cove` only ever pair this reason
      // with `Intent.Away` — heading for cover is `sheltering`, not this.
      if (intent.kind !== "away") {
        return fallbackSentence(focus);
      }
      const threat = nearestThreat(nearby);
      const who = threat ? withArticle(threat.role) : "something";
      const distance = threat ? band(threat.away) : "somewhere close";
      return `Bolted because ${who} was ${distance}.`;
    }

    case "sheltering": {
      if (intent.kind === "hide") {
        return "Hid in the kelp.";
      }
      if (intent.kind === "toward") {
        const threat = nearestThreat(nearby);
        const who = threat ? withArticle(threat.role) : "something";
        const distance = threat ? band(threat.away) : "somewhere close";
        return `Made for the kelp with ${who} ${distance}.`;
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
      if (intent.kind === "toward") {
        const morsel = richestMorsel(focus.observation.food);
        if (!morsel) {
          return fallbackSentence(focus);
        }
        return `Swam toward ${foodWord(morsel.amount)} food, ${band(morsel.away)}.`;
      }
      return fallbackSentence(focus);
    }

    case "hunting": {
      if (intent.kind === "hunt") {
        const target = nearby.find((s) => s.id === intent.targetId);
        const name = target
          ? speciesLabel(catalog, target.species, metSpecies)
          : "creature";
        const distance = target ? band(target.away) : "right beside it";
        const outcome = focus.result.startsWith("hunted-")
          ? ", and caught it."
          : focus.result.startsWith("missed-")
            ? ", and missed."
            : ".";
        return `Lunged at the ${name}, ${distance}${outcome}`;
      }
      if (intent.kind === "toward") {
        const prey = nearestCatchablePrey(nearby);
        const name = prey
          ? speciesLabel(catalog, prey.species, metSpecies)
          : "something";
        const distance = prey ? band(prey.away) : "somewhere close";
        return `Closed on the ${name}, ${distance}.`;
      }
      return fallbackSentence(focus);
    }

    case "crowded": {
      // `hermitCrab.cove` and `shyScavenger.cove` only ever pair this reason
      // with `Intent.Away` — there is no "boxed in" case any more, because a
      // continuous swim is never blocked in every direction at once the way
      // a step on a full grid could be.
      if (intent.kind !== "away") {
        return fallbackSentence(focus);
      }
      const closest = nearby[0];
      const name = closest
        ? speciesLabel(catalog, closest.species, metSpecies)
        : "someone";
      const distance = closest ? band(closest.away) : "somewhere close";
      return `Stepped away from the ${name}, ${distance}.`;
    }

    case "exploring": {
      if (intent.kind === "toward") {
        return "Wandered, with nothing in sight.";
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
 * into the headline above, so this never repeats it, and there is no more
 * "something was already there": a continuous swim is never blocked, only
 * refused (an eat with nothing in reach, a hunt with nothing to catch, a
 * hide with no cover), and a refusal already has its own sentence below. */
function note(focus: FocusSnapshot): string | null {
  if (focus.refusal) {
    return `The world refused: ${focus.refusal}.`;
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
  if (memory === "swam") return "It swam, last tick.";
  if (memory === "ate") return "It ate, last tick.";
  if (memory === "hid") return "It hid, last tick.";
  if (memory === "rested") return "It rested, last tick.";
  if (memory === "refused") {
    return "The world refused what it asked for, last tick.";
  }
  if (memory.startsWith("hunted-")) return "It caught something, last tick.";
  if (memory.startsWith("missed-")) {
    return "It lunged at something, last tick, and missed.";
  }
  return memory;
}

