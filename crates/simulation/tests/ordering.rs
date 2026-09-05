//! Resolution runs in creature-id order, and that order is what decides a
//! conflict -- not proximity, not species, not which decision looks more
//! reasonable. Two creatures asking to move onto the same empty cell must
//! settle it by id, every time, or a "random" tie-break would have crept in
//! somewhere and determinism would be a coincidence of implementation rather
//! than a guarantee.

use simulation::{
    resolve, ActionResult, Ask, Cell, Creature, Decision, Heading, Intent, Reason, Role, Roster,
    SpeciesDef, World,
};

fn one_species_roster() -> Roster {
    Roster {
        defs: vec![SpeciesDef {
            id: "mover".to_string(),
            name: "Mover".to_string(),
            role: Role::Wildcard,
            starting_energy: 20,
            stride: 1,
            forage: 5,
            capacity: 1_000_000,
            visual: simulation::catalog::VisualDef {
                colour: "#000000".to_string(),
                shape: "round".to_string(),
                size: 3,
            },
        }],
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

fn spawned(id: i64, at: Cell) -> Creature {
    Creature {
        id,
        species: 0,
        at,
        energy: 20,
        hidden: false,
        born: 0,
        last: ActionResult::Spawned,
    }
}

fn move_toward(id: i64, heading: Heading) -> Ask {
    Ask::of(
        id,
        Decision {
            intent: Intent::Move(heading),
            reason: Reason::Exploring,
        },
    )
}

// Creature 1 stands one cell west of an empty cell and creature 2 stands one
// cell east of it; both step toward it on the same tick. `world.creatures`
// is sorted by id, `resolve` walks it in that order, and only one of the two
// can have the cell -- if the lower id did not win, this would not fail
// loudly, it would fail by seed: some future run's hash would drift
// depending on an ordering nothing here pins down.
#[test]
fn the_lower_id_wins_a_contested_cell_and_the_higher_id_is_blocked() {
    let roster = one_species_roster();
    let contested = Cell { x: 5, y: 5 };
    let world = world_with(vec![
        spawned(1, Cell { x: 4, y: 5 }), // one step west of `contested`
        spawned(2, Cell { x: 6, y: 5 }), // one step east of `contested`
    ]);
    let asks = vec![move_toward(1, Heading::East), move_toward(2, Heading::West)];

    let turn = resolve(&world, &asks, &roster);

    let winner = turn
        .outcomes
        .iter()
        .find(|o| o.id == 1)
        .expect("creature 1 has an outcome");
    let loser = turn
        .outcomes
        .iter()
        .find(|o| o.id == 2)
        .expect("creature 2 has an outcome");

    assert!(
        matches!(winner.result, ActionResult::Moved(Heading::East)),
        "the lower id should win the contested cell, got {:?}",
        winner.result
    );
    assert!(
        matches!(loser.result, ActionResult::Blocked(Heading::West)),
        "the higher id should be blocked out of the cell the lower id took, got {:?}",
        loser.result
    );

    let winner_after = turn
        .world
        .creatures
        .iter()
        .find(|c| c.id == 1)
        .expect("creature 1 survives");
    assert_eq!(
        winner_after.at, contested,
        "creature 1 took the contested cell"
    );
    let loser_after = turn
        .world
        .creatures
        .iter()
        .find(|c| c.id == 2)
        .expect("creature 2 survives");
    assert_eq!(
        loser_after.at,
        Cell { x: 6, y: 5 },
        "creature 2 stayed put, blocked"
    );
}
