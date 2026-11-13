# Changelog

## Unreleased

### Fixed

- Route native directional, numbered and last-workspace shortcuts through each display's logical desktop order. Window moves use the focused window's display, and boundary actions do not add desktops.
- Keep native keyboard slides in logical desktop order, preserving retarget continuity for sparse and rotated workspace mappings.
- Use the destination window's display during Shell window-helper, app-switcher and launcher activation, preserving the other displays even when the pointer is elsewhere.
- Discard superseded animation ownership only when activation actually changes workspace, and restore normal pointer selection after the activation returns or fails.
- Follow GNOME's effective transient target during app activation and protect its related window family from compensating moves. Snapshot compensation indices so moving one relative cannot shift another twice.

### Tests

- Add native shortcut regression coverage using installed Shell callbacks bound before Orchard loads, including logical numbering, boundaries, moves, modes, deferred activation and projected animation snapshots.
- Add activation regression coverage for both display directions, the installed Shell window helper, direct window/workspace-focus calls, app activation routes, rejected requests, exceptions, nested calls and disable cleanup.
- All eleven automated suites pass against installed GNOME Shell 51.0 source. Thirty isolated real-window shortcut checks pass across both display directions, including native and Orchard key events, sparse/rotated orders, boundaries, window moves, desktop gesture settlement, overview navigation, all-displays fallback and extension disable. The unchanged activation-fix revision reproduces the physical-neighbor bug in the same harness. These are headless compositor checks, not physical-desktop visual acceptance.
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
