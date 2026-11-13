# Isolated live validation — 2026-11-13

The integrated runtime candidate is `097d603`. All implementation tracks received
Astra medium review; reported blocking defects were repaired and re-reviewed.
The final harness was reviewed at `d132438`; after the documentation rebase it
is `bbb8cb8`, with byte-identical `tests/live/` files.

These results cover private headless compositors with real GTK windows. Issue
[#3](https://github.com/cbuchler/orchard-workspace/issues/3) remains open for the
unexecuted live and physical acceptance cases below.

## Environment and provenance

- Host: Ubuntu 26.10, Wayland headless sessions, software rendering.
- Two virtual displays: 1280×800 and 1024×768. Each case targets both display
  directions, with native workspaces enabled on all displays.
- GNOME 51: installed GNOME Shell 51.0 and Mutter 51 runtime.
- GNOME 50: official Ubuntu GNOME Shell 50.1 and Mutter 50.1 packages, extracted
  into a private prefix with matching schemas, using host common libraries.
  This is not complete GNOME 50 distribution acceptance. Package hashes,
  schema provenance and the launch wrapper are retained locally.
- Only Orchard and the test observer are enabled. Settings, D-Bus, runtime
  directories and extension copies are private; no desktop extension was
  installed or updated. Shell version validation remains enabled.
- Final candidate files came from an immutable archive of `097d603`. The
  dynamic reruns also use an immutable archive of the reviewed harness.
  Per-case JSON files record candidate and harness hashes, window/workspace
  state, animation samples, logs and PNG captures.

## Final integrated candidate

Each row runs five scenarios on both displays: automatic-save disable/re-enable,
startup in all-displays mode followed by independent mode, a new compositor
process using the saved profile, fullscreen return across a mode round-trip,
and a native logical workspace switch.

| Runtime | Workspace mode | Passing cases | Operation-time JS errors | Shutdown JS diagnostics |
| --- | --- | ---: | ---: | ---: |
| GNOME Shell 50.1 | Fixed | 10/10 | 0 | 6 |
| GNOME Shell 50.1 | Dynamic | 10/10 | 0 | 14 |
| GNOME Shell 51.0 | Fixed | 10/10 | 0 | 10 |
| GNOME Shell 51.0 | Dynamic | 10/10 | 0 | 12 |

The checks compare UUID order and selected UUIDs on both displays, including
empty desktops. Extension cycling also checks existing window workspace
identities and visibility. Saving is scheduled through the production change
hook and observed in GSettings, rather than forced with `flush()`.

A new compositor cannot retain Wayland clients. The new-Shell case records two
different process IDs, observes restored orders without running fixture setup
over them, and launches fresh clients. It establishes persistence across a new
Shell process, not application session restoration or the user's logout/login.

Shutdown logs contain `dateMenu._sync` exceptions with `_settings` already null
during notification destruction. These diagnostics are preserved and counted
separately; passing operation checks do not establish error-free teardown.

## Additional recorded coverage

- Four immutable upstream source pins — 50.0, 50.6, 51.0 and 51.1 — each pass
  all 17 JavaScript source/model suites: **68 passes**. These are source checks,
  not four compositor runs. Four release-monitor tests and 14 harness validation
  tests pass independently.
- Full shortcut matrices pass 30/30 on GNOME 50.1 and 30/30 on GNOME 51.0 before
  the persistence integration. They cover logical numbering, sparse/rotated
  orders, boundaries, window moves, Orchard keys, gesture-controller settlement,
  Overview navigation, all-displays fallback and extension disable.
- At `8465ca5`, dynamic-mode switching, Overview, incoming-window restacking,
  reversal, interrupted window moves, deletion keys and fullscreen-origin
  deletion pass 16 scenarios per major. GNOME 50's initial reversal assertion
  incorrectly rejected native pruning; corrected reruns preserve strict logical
  order and visibility checks while allowing the unclaimed physical pool to
  change.
- Empty-desktop removal has 18 passing GNOME 51 real-window cases: first,
  middle, last, pointer on the other display, keyboard input, occupied/final
  rejection, and fullscreen return after deleting its origin.
- Earlier reviewed tracks retain six fullscreen adjacency checks, ten ordinary
  animation/interrupted-move checks, and the activation/shortcut evidence
  recorded with their respective revisions.

The early-GNOME-50 incoming-window restacking crash was reproduced before the
upstream repair was adapted; the same real-window scenario passes afterward.
A pre-fix interrupted-move candidate fails the sticky-clone check. An intentional
first-session screenshot failure fails before the new-Shell restart. These
negative controls are retained alongside successful results.

Failed fixture/setup runs and invalid harness runs were not counted as passes.
In particular, a rebase changed the harness while dynamic jobs were reading it;
those results were discarded and the full dynamic profiles were repeated from
immutable copies.

## Evidence and reproduction

The local evidence index is:

```text
~/.local/state/orchard-workspace/parallel-tracks-20261113/summary.json
~/.local/state/orchard-workspace/parallel-tracks-20261113/source-matrix.json
~/.local/state/orchard-workspace/parallel-tracks-20261113/live/
~/.local/state/orchard-workspace/gnome-50-runtime-20261113/
```

Run the [harness commands in README](../README.md#isolated-live-validation) with
a fresh output directory. The support policy, pinned-source audit and version
adapter boundaries are in [GNOME_COMPATIBILITY.md](GNOME_COMPATIBILITY.md).

## Remaining acceptance under #3

- Physical two-display behavior, actual touchpad input and pointer crossing
  during rapid interactions on the user's normal desktop.
- Physical unplug/replug, migrated windows and restored display identity.
- The user's normal extension combination and representative applications.
- A complete live Overview mouse/scroll/drag-and-drop matrix and the remaining
  nested fullscreen, sticky/transient, manual-move and owner-close combinations
  on both supported majors. Existing model coverage does not replace these.
- Full distribution/session acceptance and later maintenance-patch compositor
  runs; the four source pins alone do not establish those results.
