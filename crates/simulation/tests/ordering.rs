//! Resolution runs in creature-id order, and that order is what decides a
//! conflict -- not proximity, not species, not which decision looks more
//! reasonable. There is no cell to contest any more in a continuous reef, so
//! the one conflict order still settles is two hunters naming the same prey:
//! the lower id's hunt is drawn first, and if it lands, the higher id's is
//! refused for a prey "already taken", never drawn at all. If the lower id
//! did not go first, this would not fail loudly -- it would fail by seed,
//! some future run's hash drifting depending on an ordering nothing here
//! pins down.

use simulation::{
    resolve, ActionResult, Ask, Creature, Decision, Intent, Point, Reason, Role, Roster,
    SpeciesDef, World,
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

/// Seed `1`'s first draw of `roll(_, 100)` is `38`, comfortably under
/// `STRIKE` (`70`) -- computed once from the generator's own recurrence and
/// pinned here, the same way `generator.rs`'s own test pins its first draws.
/// That is what makes the lower-id hunter's strike land deterministically,
/// which is the only way this test can assert on the *order* rather than on
/// luck.
const SEED_WHOSE_FIRST_STRIKE_LANDS: i64 = 1;

fn world_with(creatures: Vec<Creature>) -> World {
    World {
        tick: 0,
        seed: SEED_WHOSE_FIRST_STRIKE_LANDS,
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

fn spawned(id: i64, species: usize, at: Point) -> Creature {
    Creature {
        id,
        species,
        at,
        facing: Point::new(1.0, 0.0),
        speed: 0.0,
        energy: 20,
        born: 0,
        hidden: false,
        last: ActionResult::Spawned,
    }
}

fn hunt(id: i64, target: i64) -> Ask {
    Ask::of(
        id,
        Decision {
            intent: Intent::Hunt(target),
            reason: Reason::Hunting,
        },
    )
}

// Two hunters, both within reach of the same prey: the lower id is resolved
// first, its strike lands (seed 1's first draw is under `STRIKE`), and the
// higher id's hunt of the same, now-taken prey is refused without ever being
// drawn for.
#[test]
fn the_lower_id_hunts_first_and_the_higher_id_finds_the_prey_already_taken() {
    let roster = roster_of(Role::Hunter, Role::Grazer);
    let prey_at = Point::new(5.0, 5.0);
    let world = world_with(vec![
        spawned(1, 0, Point::new(4.0, 5.0)), // one unit west of the prey
        spawned(2, 0, Point::new(6.0, 5.0)), // one unit east of the prey
        spawned(3, 1, prey_at),
    ]);
    let asks = vec![
        hunt(1, 3),
        hunt(2, 3),
        Ask::of(
            3,
            Decision {
                intent: Intent::Rest,
                reason: Reason::Waiting,
            },
        ),
    ];

    let turn = resolve(&world, &asks, &roster);

    let first = turn
        .outcomes
        .iter()
        .find(|o| o.id == 1)
        .expect("hunter 1 has an outcome");
    assert_eq!(
        first.result,
        ActionResult::Hunted(3),
        "the lower id should strike first and land it, got {:?}",
        first.result
    );

    let second = turn
        .outcomes
        .iter()
        .find(|o| o.id == 2)
        .expect("hunter 2 has an outcome");
    match &second.result {
        ActionResult::Refused(why) => assert!(
            why.contains("taken"),
            "expected the refusal to name the prey as already taken, got: {why}"
        ),
        other => panic!(
            "the higher id should be refused a prey the lower id already took, got {other:?}"
        ),
    }

    assert!(
        turn.world.creatures.iter().all(|c| c.id != 3),
        "the prey should not survive a landed hunt"
    );
}
