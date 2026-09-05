//! Cover is the one place a hunt cannot reach, and a hidden creature is
//! visible but uncatchable — not invisible. Two separate claims, checked
//! separately, and the second one is the opposite of what the grid world's
//! own cover used to mean: `contract.cove`'s own doc says a hidden creature
//! stays in `nearby`, because `kelpHunter` relies on being able to see one it
//! cannot reach.

use simulation::{
    observe, resolve, ActionResult, Ask, Decision, Intent, Point, Reason, Role, Roster, SpeciesDef,
    World,
};

fn roster_of(hunter_role: Role, prey_role: Role) -> Roster {
    let def = |id: &str, role: Role| SpeciesDef {
        id: id.to_string(),
        name: id.to_string(),
        role,
        starting_energy: 20,
        cruise: 1.0,
        agility: 0.3,
        forage: 5,
        capacity: 1_000_000,
        visual: simulation::catalog::VisualDef {
            colour: "#000000".to_string(),
            shape: "round".to_string(),
            size: 3,
        },
    };
    Roster {
        defs: vec![def("hunter", hunter_role), def("prey", prey_role)],
    }
}

fn world_with(creatures: Vec<simulation::Creature>) -> World {
    World {
        tick: 0,
        seed: 1,
        reef: Point::new(100.0, 75.0),
        food: Vec::new(),
        kelp: Vec::new(),
        creatures,
        cast: Vec::new(),
        pending: Vec::new(),
        next_id: 100,
        births: 0,
        deaths: 0,
        refusals: 0,
    }
}

fn spawned(id: i64, species: usize, at: Point, hidden: bool) -> simulation::Creature {
    simulation::Creature {
        id,
        species,
        at,
        facing: Point::new(1.0, 0.0),
        speed: 0.0,
        energy: 20,
        born: 0,
        hidden,
        last: ActionResult::Spawned,
    }
}

// A hunter within reach of prey that is hidden is refused, naming the kelp --
// if hiding did not stop a hunt, the module doc's claim that "no lunge
// reaches into kelp" would be describing a species this port did not honour.
#[test]
fn a_hunt_of_a_hidden_creature_is_refused() {
    let roster = roster_of(Role::Hunter, Role::Grazer);
    let world = world_with(vec![
        spawned(1, 0, Point::new(1.0, 0.0), false), // the hunter
        spawned(2, 1, Point::new(0.0, 0.0), true),  // the prey, hidden in kelp
    ]);
    let asks = vec![
        Ask::of(
            1,
            Decision {
                intent: Intent::Hunt(2),
                reason: Reason::Hunting,
            },
        ),
        Ask::of(
            2,
            Decision {
                intent: Intent::Rest,
                reason: Reason::Waiting,
            },
        ),
    ];

    let turn = resolve(&world, &asks, &roster);
    let hunt = turn
        .outcomes
        .iter()
        .find(|o| o.id == 1)
        .expect("the hunter has an outcome");
    match &hunt.result {
        ActionResult::Refused(why) => {
            assert!(
                why.contains("hidden"),
                "expected the refusal to name the hiding, got: {why}"
            );
        }
        other => panic!("expected the hunt of a hidden creature to be refused, got {other:?}"),
    }
    // The prey survives the tick unharmed: cover is not merely worse odds,
    // it is a hunt that never happens.
    let prey_after = turn
        .world
        .creatures
        .iter()
        .find(|c| c.id == 2)
        .expect("the prey survives");
    assert_eq!(
        prey_after.energy, 19,
        "the prey only paid upkeep, nothing else"
    );
}

// A hidden creature still appears in another's `nearby` -- it is visible and
// uncatchable, which is deliberate: `kelpHunter` follows what it can see even
// when it cannot reach it, so if this ever started filtering hidden
// creatures out, a hunter would lose track of prey the moment it ducked into
// kelp instead of merely losing its lunge.
#[test]
fn a_hidden_creature_still_appears_in_anyones_nearby() {
    let roster = roster_of(Role::Hunter, Role::Grazer);
    let world = world_with(vec![
        spawned(1, 0, Point::new(1.0, 0.0), false),
        spawned(2, 1, Point::new(0.0, 0.0), true), // hidden, one unit away
    ]);

    let observation = observe(&world, 1, &roster).expect("creature 1 is alive");
    let seen = observation
        .nearby
        .iter()
        .find(|s| s.id == 2)
        .expect("the hidden creature is still in nearby");
    assert!(seen.hidden, "the sighting should say it is hidden");
}
