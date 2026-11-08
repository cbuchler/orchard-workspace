# Changelog

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
