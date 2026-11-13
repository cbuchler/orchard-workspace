# Changelog

## Unreleased

### Compatibility

- Declare GNOME Shell 50 and 51 support under the current/previous stable-major policy. Add a GNOME 50 Overview keyboard adapter and the upstream restacking repair needed by GNOME 50.0–50.3 when a window arrives during a slide. Detect required incompatible internals before activation, and restore compatibility hooks on disable.
- Run 17 source/model suites against pinned GNOME 50.0, 50.6, 51.0 and 51.1 sources in CI, with exact hashes and scheduled stable-release monitoring. Isolated GNOME Shell/Mutter 50.1 checks pass 30 shortcut cases and ten focused animation/Overview/fullscreen cases on extracted official packages using host common libraries. Physical-desktop and complete GNOME 50 distribution acceptance remain separate; see [exact evidence and limits](docs/GNOME_COMPATIBILITY.md).

### Added

- Remove an empty logical desktop with Ctrl+Super+Delete, preserving the other display, at least one desktop and live fullscreen return paths.
- Persist ordinary per-display desktop UUIDs, order and selection across disable/re-enable and new Shell sessions. Rebuild empty desktop backings, retain current occupied desktops without moving windows, and match changed connectors only through unambiguous hardware identity. Temporary fullscreen ownership is not saved.

### Fixed

- Insert temporary fullscreen desktops immediately after their stable origin, preserving nested return paths and unrelated desktop order.
- Animate ordinary Orchard navigation and selected desktop creation consistently with native shortcuts. Preserve requested moving-window ownership during interrupted slides and expire unconsumed ownership.
- Route native directional, numbered and last-workspace shortcuts through each display's logical desktop order. Window moves use the focused window's display, and boundary actions do not add desktops.
- Keep native keyboard slides in logical desktop order, preserving retarget continuity for sparse and rotated workspace mappings.
- Use the destination window's display during Shell window-helper, app-switcher and launcher activation, preserving the other displays even when the pointer is elsewhere.
- Discard superseded animation ownership only when activation actually changes workspace, and restore normal pointer selection after the activation returns or fails.
- Follow GNOME's effective transient target during app activation and protect its related window family from compensating moves. Snapshot compensation indices so moving one relative cannot shift another twice.

### Tests

- Add persistence/reconciliation model coverage for renumbering, pruned empty desktops, new-session occupancy and selected UUIDs, absent/ambiguous display identities, fullscreen exclusion, corrupt/unsupported state and owned save-idle cleanup. Live restart/reconnect acceptance remains separate.
- Add a reusable isolated real-window compositor harness with private settings/bus, source manifests, fixture validation, per-frame animation samples, PNG captures and explicit failure reports.
- Pass 40 final integrated real-window checks across GNOME 50.1/51.0, both displays and fixed/dynamic modes, including automatic persistence, extension/new-Shell restarts and fullscreen mode transitions. Retain shutdown diagnostics and outstanding acceptance separately in [LIVE_VALIDATION.md](docs/LIVE_VALIDATION.md).
- Add native shortcut regression coverage using installed Shell callbacks bound before Orchard loads, including logical numbering, boundaries, moves, modes, deferred activation and projected animation snapshots.
- Add activation regression coverage for both display directions, the installed Shell window helper, direct window/workspace-focus calls, app activation routes, rejected requests, exceptions, nested calls and disable cleanup.
- Source-backed automated suites pass against installed GNOME Shell 51.0 source. Thirty isolated real-window shortcut checks pass across both display directions, including native and Orchard key events, sparse/rotated orders, boundaries, window moves, desktop gesture settlement, overview navigation, all-displays fallback and extension disable. The unchanged activation-fix revision reproduces the physical-neighbor bug in the same harness. These are headless compositor checks, not physical-desktop visual acceptance.
- The activation fix also has isolated two-monitor real-window evidence for six activation routes, cross-display normal transients, and interruption of keyboard animation and gesture settlement.

## [0.1.1] - 2026-11-08

### Fixed

- Keep the current slide position and velocity when repeated keyboard workspace switches interrupt an animation, including direction reversals.
- Keep inactive displays stationary during animated keyboard switches without exposing hidden windows from stale snapshots.
- Keep the selected display fixed until the keyboard slide finishes, even when the pointer moves to another display.
- Clean up interrupted animation actors and callbacks on cancellation, extension disable, display changes, and workspace-pool changes.

### Tests and documentation

- Add regression coverage for repeated taps, reversals, animation timing, vertical and right-to-left layouts, inactive-display windows, and gesture handoff.
- Document keyboard animation behavior and the extra temporary window clones needed for large workspace pools.
- All nine automated suites pass against GNOME Shell 51 source with simulated actors and windows. JavaScript syntax and strict GSettings schema checks pass. Live desktop behavior and appearance have not been verified for this release.

## [0.1.0] - 2026-11-06

- First public release for GNOME Shell 51.
- Switch workspaces on the display under the pointer or on all displays together.
- Add workspaces per display and give fullscreen application windows temporary workspaces with return paths.
- Support desktop gestures, keyboard shortcuts, and per-display overview navigation through scrolling, thumbnails, and window drops.
- Document installation, configuration, limitations, tests, attribution, and AI-assisted generation.

[0.1.1]: https://github.com/cbuchler/orchard-workspace/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cbuchler/orchard-workspace/releases/tag/v0.1.0
