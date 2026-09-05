//! Cover is the one place a hunt cannot reach, and hiding is the one thing a
//! creature can do that removes it from every other creature's `nearby` --
//! not just from view, but from what a step can be blocked by. Two separate
//! claims, checked separately.

use simulation::{
    observe, resolve, ActionResult, Ask, Cell, Creature, Decision, Intent, Reason, Role, Roster,
    SpeciesDef, World,
};

fn roster_of(hunter_role: Role, prey_role: Role) -> Roster {
    let def = |id: &str, role: Role| SpeciesDef {
        id: id.to_string(),
        name: id.to_string(),
        role,
        starting_energy: 20,
        stride: 1,
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

fn world_with(creatures: Vec<Creature>) -> World {
    World {
        tick: 0,
        seed: 1,
        width: 10,
        height: 10,
        food: vec![0; 100],
        creatures,
        cast: Vec::new(),
        pending: Vec::new(),
        next_id: 100,
        births: 0,
        deaths: 0,
        refusals: 0,
    }
}

fn spawned(id: i64, species: usize, at: Cell, hidden: bool) -> Creature {
    Creature {
        id,
        species,
        at,
        energy: 20,
        hidden,
        born: 0,
        last: ActionResult::Spawned,
    }
}

// `(0, 0)` is a thicket: `(0*3 + 0*5) % 7 == 0`. A hunter standing next to
// it, hunting the prey that stands in it, is refused -- if cover did not
// stop a hunt, the reference's own comment about thickets ("a run with
// nowhere safe ends with the predators eating everything and then starving
// in an empty world... it did, before this was here") would be describing
// this port too.
#[test]
fn a_hunt_into_cover_is_refused() {
    assert!(
        simulation::is_shelter(Cell { x: 0, y: 0 }),
        "test setup assumes (0,0) is a thicket"
    );
    let roster = roster_of(Role::Hunter, Role::Grazer);
    let world = world_with(vec![
        spawned(1, 0, Cell { x: 1, y: 0 }, false), // the hunter
        spawned(2, 1, Cell { x: 0, y: 0 }, false), // the prey, in cover
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
                why.contains("thicket"),
                "expected the refusal to name the thicket, got: {why}"
            );
        }
        other => panic!("expected the hunt into cover to be refused, got {other:?}"),
    }
    // The prey survives the tick unharmed: cover is not merely a worse odds,
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

// A creature that hid does not appear in another's `nearby`, even though it
// is standing well within sight range -- and `observe` is what a species'
// own `decide` is shown, so if this ever failed a hunter would be able to
// see a creature the world is supposed to be treating as gone.
#[test]
fn a_hidden_creature_is_not_visible_in_anyone_elses_nearby() {
    let roster = roster_of(Role::Hunter, Role::Grazer);
    let world = world_with(vec![
        spawned(1, 0, Cell { x: 1, y: 0 }, false),
        spawned(2, 1, Cell { x: 0, y: 0 }, true), // hidden, one step west
    ]);

    let observation = observe(&world, 1, &roster).expect("creature 1 is alive");
    assert!(
        observation.nearby.iter().all(|s| s.id != 2),
        "the hidden creature should not appear in creature 1's nearby: {:?}",
        observation.nearby
    );

    // The cell the hidden creature stands on also reads as unoccupied in
    // `around`, which is what lets a step into it still be blocked at
    // resolution without the observation lying about who is there.
    let patch_at_hidden_cell = observation
        .around
        .iter()
        .find(|p| p.at == Cell { x: 0, y: 0 })
        .expect("the west patch is the cell the hidden creature stands on");
    assert!(
        !patch_at_hidden_cell.occupied,
        "the patch over a hidden creature should read unoccupied"
    );
}
