# Orchard Workspace

Switch workspaces on one display while the others stay in place.

Move the pointer to a display, then use a workspace gesture or shortcut. Each
display has its own workspace list. Fullscreen windows get a temporary workspace
beside the one they came from. Saved workspace lists return after you re-enable
Orchard or log in again.

Orchard supports **GNOME Shell 50 and 51**. It is experimental; display setups
and other extensions still need broader testing.

## Get started

1. Follow the [installation guide](docs/INSTALL.md).
2. Open **Settings → Multitasking**. Select **Workspaces on all displays**.
3. Enable **Orchard Workspace** in the Extensions app.

Keep **Switch only the active display** on in Orchard's preferences. Turn it off
to switch all displays together. Fixed and dynamic workspaces both work.

If you use Kiwi, turn off its **Move Window to New Workspace** option. Disable
other copies of Active Monitor Workspaces before you enable Orchard.

## Everyday use

Place the pointer on the display you want to use.

| Shortcut | Action | Where |
| --- | --- | --- |
| **Ctrl+Super+Up** | Previous workspace | Desktop |
| **Ctrl+Super+Down** | Next workspace | Desktop |
| **Ctrl+Super+N** | Add a workspace and switch to it | Desktop and overview |
| **Ctrl+Super+Delete** | Remove the current empty workspace | Desktop and overview |

**Super** is usually the Windows key. Add and remove workspaces with
**Switch only the active display** on. Orchard keeps at least one workspace per
display and does not remove occupied workspaces.

GNOME's workspace gestures and configured shortcuts also work. Shortcuts that
move a window use that window's display. Opening an existing window from the
app switcher or launcher reveals it on its own display.

Use the application's fullscreen control to enter or leave fullscreen. Orchard
returns the window to its source workspace when you leave fullscreen. Maximizing
a window does not create a workspace.

## Learn more

- [Workspace behavior and settings](docs/USAGE.md) — fullscreen, saved layouts,
  custom shortcuts and troubleshooting.
- [Install, update or remove Orchard](docs/INSTALL.md).
- [Development and testing](docs/DEVELOPMENT.md).
- [Changelog](CHANGELOG.md).

For help or feature requests, [open an issue](https://github.com/cbuchler/orchard-workspace/issues).
For a bug, include the steps, expected result, actual result and GNOME version.
See the [reporting guide](docs/DEVELOPMENT.md#report-a-problem) for more detail.

## About

This project was built with help from AI models. It uses manual installation
and will not be distributed through extensions.gnome.org.

Orchard builds on [Active Monitor Workspaces](https://github.com/IndyDevGuy/active-monitor-workspaces)
and its [source project](https://github.com/micheledaros/gnome-shell-extension-simulate-switching-workspaces-on-active-monitor).
See [LICENSE](LICENSE) for the MIT terms and copyright notices.
