//! Two places name the Cove commit this crate is built against, and nothing
//! keeps them the same but this test: the workspace manifest pins it as a
//! build input, and `creature_host::COVE_COMMIT` names it again as a replay
//! identity. A dependency bump that only touched the manifest would leave a
//! replay identity claiming the wrong commit built it.

use std::path::{Path, PathBuf};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

// The manifest's `rev = "..."` and `COVE_COMMIT` are read from two different
// places and compared as text — no TOML parser, since a needle search is all
// a single string constant needs.
#[test]
fn cove_commit_matches_every_rev_the_manifest_pins() {
    let manifest_path = workspace_root().join("Cargo.toml");
    let manifest = std::fs::read_to_string(&manifest_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", manifest_path.display()));

    let revs: Vec<&str> = manifest
        .lines()
        .filter(|line| line.contains("git = \"https://github.com/myuon/cove\""))
        .filter_map(|line| {
            let needle = "rev = \"";
            let start = line.find(needle)? + needle.len();
            let rest = &line[start..];
            let end = rest.find('"')?;
            Some(&rest[..end])
        })
        .collect();

    assert!(
        !revs.is_empty(),
        "found no `cove-*` git dependency with a `rev` in {}",
        manifest_path.display()
    );
    for rev in &revs {
        assert_eq!(
            *rev,
            creature_host::COVE_COMMIT,
            "a dependency in the manifest is pinned to a different commit than COVE_COMMIT names"
        );
    }
}
