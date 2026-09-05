//! Whether the reef will carry out a well-typed decision.
//!
//! The checker only proves a decision names something `Decision` can name; it
//! is `admissible` that answers whether the thing named is there. Every arm
//! of `admissible` gets its own case here, built from the smallest
//! `SelfView`/`Observation` that reaches it, plus the fixture the crate ships
//! specifically to be refused.

use std::path::{Path, PathBuf};

use creature_host::{
    admissible, scenario, ActionResult, Aim, Intent, Observation, Point, Reason, Role, SelfView,
    Sighting, Species, Verdict,
};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn catalog_dir() -> PathBuf {
    workspace_root().join(creature_host::CATALOG)
}

fn broken(name: &str) -> Species {
    let catalog = catalog_dir();
    let creature = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("broken")
        .join(name);
    Species::compose(
        name,
        &catalog.join("contract"),
        &catalog.join("instinct"),
        &creature,
    )
    .unwrap_or_else(|e| panic!("{name} does not compose: {e}"))
}

fn plain_view() -> SelfView {
    SelfView {
        id: 1,
        species: 1,
        role: Role::Scavenger,
        at: Point::new(10.0, 10.0),
        facing: Point::new(1.0, 0.0),
        speed: 0.0,
        energy: 20,
        age: 1,
        hidden: false,
        last: ActionResult::Spawned,
    }
}

fn plain_world() -> Observation {
    Observation {
        tick: 1,
        reef: Point::new(100.0, 75.0),
        sight: 16.0,
        reach: 3.0,
        here: 0.0,
        sheltered: false,
        nearby: Vec::new(),
        food: Vec::new(),
        kelp: Vec::new(),
    }
}

// A well-typed `Hunt` of a creature nothing can see is exactly what
// `wrongTarget` is built to always ask for. If `admissible` ever started
// allowing it, the reef would resolve a hunt against a target it was never
// shown.
#[test]
fn wrong_target_is_refused_a_creature_nothing_can_see() {
    let species = broken("wrongTarget");
    let lowering = species.lower().expect("wrongTarget lowers");
    let (view, world) = scenario::empty();
    let outcome = species.serve(&lowering, |session| session.decide_unbounded(&view, &world));
    let decision = outcome.decision().expect("wrongTarget always answers");
    assert!(matches!(decision.intent, Intent::Hunt(_)));

    let verdict = admissible(&view, &world, decision);
    let Verdict::Refused(why) = &verdict else {
        panic!("hunting a creature nothing can see should be refused, got {verdict:?}");
    };
    assert_eq!(verdict.result(), ActionResult::Refused(why.clone()));
}

// `cornered` is built so the scavenger has no shelter in sight and no cover
// underfoot, and asks to hide where it is floating. `admissible` refuses
// that -- there is no cover here -- and the contract's answer-back is what
// stops it asking the same impossible thing a second time: told
// `last: Refused(_)`, `lastResort` swims away instead. This is the one place
// in the species where the reef's refusal changes what it does next, and it
// is worth its own test.
#[test]
fn a_refused_hide_is_not_asked_for_twice() {
    let species = Species::load(&catalog_dir(), "shyScavenger").expect("shyScavenger loads");
    let lowering = species.lower().expect("lowers");
    let (view, world) = scenario::cornered();

    species.serve(&lowering, |session| {
        let outcome = session.decide_unbounded(&view, &world);
        let decision = outcome.decision().expect("cornered always answers");
        assert_eq!(decision.line(), "hide because=sheltering");

        let verdict = admissible(&view, &world, decision);
        assert_eq!(
            verdict,
            Verdict::Refused("there is no cover here".to_string())
        );

        // The contract's answer-back: told last tick was refused, the
        // scavenger swims away instead of asking to hide again.
        let told_it_was_refused = SelfView {
            last: ActionResult::Refused("there is no cover here".to_string()),
            ..view
        };
        let second = session
            .decide_unbounded(&told_it_was_refused, &world)
            .decision()
            .expect("cornered always answers");
        assert_eq!(second.line(), "away because=fleeing_threat");
    });
}

// An eat where nothing is in reach is refused.
#[test]
fn an_eat_with_nothing_in_reach_is_refused() {
    let view = plain_view();
    let world = plain_world(); // here: 0.0
    let verdict = admissible(
        &view,
        &world,
        creature_host::Decision {
            intent: Intent::Eat,
            reason: Reason::Feeding,
        },
    );
    assert_eq!(
        verdict,
        Verdict::Refused("there is nothing here to eat".to_string())
    );
}

// A hunt of a sighting past the reef's own reach is refused before the
// question of who hunts and who is prey is ever asked.
#[test]
fn a_hunt_of_something_too_far_away_is_refused() {
    let view = SelfView {
        role: Role::Hunter,
        ..plain_view()
    };
    let mut world = plain_world();
    world.nearby.push(Sighting {
        id: 7,
        species: 2,
        role: Role::Grazer,
        at: Point::new(10.0, 20.0),
        away: 10.0,
        facing: Point::new(0.0, 1.0),
        hidden: false,
    });
    let verdict = admissible(
        &view,
        &world,
        creature_host::Decision {
            intent: Intent::Hunt(7),
            reason: Reason::Hunting,
        },
    );
    assert_eq!(
        verdict,
        Verdict::Refused("creature 7 is 10.00 away, past a reach of 3.00".to_string())
    );
}

// A hunt of a creature hidden in kelp is refused: no lunge reaches into
// cover, whatever the distance.
#[test]
fn a_hunt_of_a_hidden_creature_is_refused() {
    let view = SelfView {
        role: Role::Hunter,
        ..plain_view()
    };
    let mut world = plain_world();
    world.nearby.push(Sighting {
        id: 7,
        species: 2,
        role: Role::Grazer,
        at: Point::new(11.0, 10.0),
        away: 1.0,
        facing: Point::new(-1.0, 0.0),
        hidden: true,
    });
    let verdict = admissible(
        &view,
        &world,
        creature_host::Decision {
            intent: Intent::Hunt(7),
            reason: Reason::Hunting,
        },
    );
    assert_eq!(
        verdict,
        Verdict::Refused("creature 7 is hidden in kelp, and no lunge reaches into it".to_string())
    );
}

// A hunt by a role that does not hunt is refused, even when the target is in
// range and is prey.
#[test]
fn a_hunt_by_a_role_that_does_not_hunt_is_refused() {
    let view = SelfView {
        role: Role::Grazer,
        ..plain_view()
    };
    let mut world = plain_world();
    world.nearby.push(Sighting {
        id: 7,
        species: 2,
        role: Role::Grazer,
        at: Point::new(11.0, 10.0),
        away: 1.0,
        facing: Point::new(-1.0, 0.0),
        hidden: false,
    });
    let verdict = admissible(
        &view,
        &world,
        creature_host::Decision {
            intent: Intent::Hunt(7),
            reason: Reason::Hunting,
        },
    );
    assert_eq!(
        verdict,
        Verdict::Refused("a Grazer does not hunt".to_string())
    );
}

// A hide with no cover is refused.
#[test]
fn a_hide_with_no_cover_is_refused() {
    let view = plain_view();
    let world = plain_world(); // sheltered: false
    let verdict = admissible(
        &view,
        &world,
        creature_host::Decision {
            intent: Intent::Hide,
            reason: Reason::Sheltering,
        },
    );
    assert_eq!(
        verdict,
        Verdict::Refused("there is no cover here".to_string())
    );
}

// A swim, toward or away, is never refused: there is no cell to contest in a
// continuous reef, and the reef clamps a swim at its edge rather than
// declining it.
#[test]
fn a_swim_is_never_refused() {
    let (adversarial_view, adversarial_world) = scenario::adversarial();
    let toward = admissible(
        &adversarial_view,
        &adversarial_world,
        creature_host::Decision {
            intent: Intent::Toward(Aim {
                at: Point::new(1.0, 1.0),
                effort: 1.0,
            }),
            reason: Reason::Exploring,
        },
    );
    assert!(toward.allowed());
    let away = admissible(
        &adversarial_view,
        &adversarial_world,
        creature_host::Decision {
            intent: Intent::Away(Aim {
                at: Point::new(1.0, 1.0),
                effort: 1.0,
            }),
            reason: Reason::FleeingThreat,
        },
    );
    assert!(away.allowed());
}

// A rest is never refused, whatever the view or the world says.
#[test]
fn a_rest_is_never_refused() {
    let (adversarial_view, adversarial_world) = scenario::adversarial();
    let verdict = admissible(
        &adversarial_view,
        &adversarial_world,
        creature_host::Decision {
            intent: Intent::Rest,
            reason: Reason::Waiting,
        },
    );
    assert_eq!(verdict, Verdict::Allowed(Intent::Rest));
    assert!(verdict.allowed());
}
