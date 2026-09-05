// What each species is, in the words its own source uses.
//
// Every sentence below is copied, not written for this page: each
// `catalog/species/<id>/creature.cove` opens with a comment stating exactly
// what that species is, and this is that sentence and only that sentence.
// The legend is what the exit criterion actually rests on — shape and colour
// let a visitor tell four creatures apart, but only this sentence lets them
// connect a creature they are watching to a rule they can reason about
// without opening a source file.
//
// Keyed by `species.toml`'s `id`, which is `Snapshot.catalog[n].id`.
export const SPECIES_SUMMARY: Readonly<Record<string, string>> = {
  reefGrazer: "Eats what grows, and runs from what eats it.",
  kelpHunter: "Hunts what it can reach, and follows what it cannot.",
  shyScavenger: "Hides first, eats second, and waits for the rest.",
  hermitCrab:
    "Steps away from anybody who comes near, unless it is hungry and standing on food.",
};
