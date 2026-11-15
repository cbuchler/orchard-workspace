# Workspace behavior and settings

[Back to the README](../README.md) · [Installation](INSTALL.md)

## Select a display

Move the pointer to the display you want to switch. Use a workspace gesture or
shortcut. Orchard keeps the other displays in place.

An animated keyboard switch keeps its selected display until the animation
ends. Moving the pointer during that animation does not change its target.

Shortcuts that move a window use the focused window's display. The app switcher
and launcher use the display of the window they activate.

Orchard adds no panel indicator, notification or workspace popup.

## Add or remove workspaces

Turn on **Switch only the active display** in Orchard's preferences.

- Press **Ctrl+Super+N** to add a workspace and switch to it.
- Press **Ctrl+Super+Delete** to remove the current empty workspace.

Both shortcuts work on the desktop and in the overview. Orchard selects the
previous workspace after removal. If you remove the first workspace, it selects
the next one. Orchard keeps at least one workspace per display. It rejects
removal if a workspace contains windows or belongs to a fullscreen window.

Each display starts with one workspace unless a saved list or existing windows
require more. Orchard keeps occupied workspaces when it creates the list.

## Use GNOME's controls

Desktop gestures follow the workspace order of the selected display. In the
overview, you can also use the mouse wheel, Page Up/Down, workspace thumbnails
and window drops. Navigation stops at the ends of the list.

GNOME's configured workspace shortcuts use the same list:

| Control | Result in active-display mode |
| --- | --- |
| Previous or next workspace | Select the adjacent workspace. |
| Numbered workspace shortcut | Select that position in the list, starting at 1. |
| Last-workspace shortcut | Select the last workspace. |
| Move-to-workspace shortcut | Move the focused window within its display's list. |

An unavailable workspace number does nothing. Previous/next and move shortcuts
do not create a workspace at a list boundary.

To switch all displays together, turn off **Switch only the active display**.
GNOME then uses its normal shared workspace numbering and navigation.

## Use fullscreen windows

Use the application's fullscreen control, such as F11 where supported. Orchard
creates a temporary workspace immediately after the window's source workspace.
When fullscreen ends, Orchard returns the window to its source workspace.
The fullscreen window, or its focused dialog, keeps keyboard focus.

These rules apply to normal application windows in active-display mode.
Maximizing a window does not create a workspace.

| Situation | Result |
| --- | --- |
| You open another fullscreen window from a temporary workspace. | Orchard keeps a separate return path for each window. |
| You move the fullscreen window yourself. | Orchard stops managing that window's return. |
| You put other windows in the temporary workspace. | Orchard keeps that workspace when fullscreen ends. |

GNOME can activate a dialog instead of its parent window. Orchard follows that
choice. GNOME moves related windows together, including relatives on another
display. Those related windows cannot switch independently. Unrelated windows
keep their selected workspace.

## Saved workspace lists

Orchard saves each recognized display's workspace list, order and selection.
The saved list includes empty workspaces. It excludes temporary fullscreen
ownership.

When you re-enable Orchard, it restores the list without moving windows.
A workspace selection made while Orchard was disabled takes priority over the
saved selection. Closed or moved windows can change how Orchard matches the
saved list to current workspaces.

After a new login, Orchard restores the selected list entry on the current
workspace. It assigns other occupied workspaces in GNOME's current order.
It then restores empty entries. It keeps additional occupied workspaces.
This restores workspace lists; it does not restore application sessions.

Orchard matches displays by connector and available hardware information.
It uses hardware information alone only when the match is unambiguous.
Unmatched displays start from their current windows. Saved lists for absent
displays remain available for a later connection.

### Technical notes

GNOME has one shared workspace pool. Orchard gives each display a logical list
from that pool. It adds native workspaces when the list needs them. In dynamic
mode, Orchard retains its assigned workspaces. GNOME manages the rest.

Logical workspaces have saved UUIDs. During one Shell session, saved window
sequence numbers identify occupied native workspaces. Disable releases the
runtime bindings. An empty entry can receive a different native workspace on
re-enable. Its UUID, list position and count remain saved.

The internal `logical-layout` setting stores versioned data. The format allows
32 display identities and 64 ordinary workspaces per display. Invalid or
unsupported data falls back to the current occupied layout. All-displays mode
leaves the saved per-display layout unchanged.

## Change settings and shortcuts

The preferences window contains **Switch only the active display**. Its default
is on. Use GSettings to change shortcuts.

1. Set the schema path for a standard user installation:

   ```sh
   orchard_schema_dir="$HOME/.local/share/gnome-shell/extensions/orchard-workspace@cbuchler.github.io/schemas"
   ```

   If you installed Orchard elsewhere, use that installation's `schemas` directory.

2. Read the settings:

   ```sh
   gsettings --schemadir "$orchard_schema_dir" list-recursively org.gnome.shell.extensions.orchard-workspace
   ```

3. Set the shortcut you want. This example changes Add Workspace to Ctrl+Super+M:

   ```sh
   gsettings --schemadir "$orchard_schema_dir" set org.gnome.shell.extensions.orchard-workspace add-active-display-workspace "['<Control><Super>m']"
   ```

To restore that shortcut's default, run:

```sh
gsettings --schemadir "$orchard_schema_dir" reset org.gnome.shell.extensions.orchard-workspace add-active-display-workspace
```

| Setting key | Purpose |
| --- | --- |
| `active-monitor-only` | Select active-display mode or all-displays mode. |
| `switch-active-display-previous` | Set the previous-workspace shortcut. |
| `switch-active-display-next` | Set the next-workspace shortcut. |
| `add-active-display-workspace` | Set the add-workspace shortcut. |
| `remove-active-display-workspace` | Set the remove-empty-workspace shortcut. |
| `logical-layout` | Store internal saved layouts. Do not edit this value manually. |

### Reset saved layouts

Set `orchard_schema_dir` as shown above before you start.

1. Disable Orchard:

   ```sh
   gnome-extensions disable orchard-workspace@cbuchler.github.io
   ```

2. Clear the saved layouts:

   ```sh
   gsettings --schemadir "$orchard_schema_dir" reset org.gnome.shell.extensions.orchard-workspace logical-layout
   ```

3. Enable Orchard:

   ```sh
   gnome-extensions enable orchard-workspace@cbuchler.github.io
   ```

This clears the saved lists. Orchard builds new lists from the current layout.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Independent switching does not work. | Select **Workspaces on all displays** in GNOME Settings. Turn on **Switch only the active display** in Orchard. |
| A fullscreen window moves unexpectedly or returns to the wrong workspace. | Turn off Kiwi's **Move Window to New Workspace** option. Check other extensions that move fullscreen windows. |
| New code does not appear after an update. | On Wayland, log out and log in again. Replacing files does not reload the running Shell code. |
| You cannot remove a workspace. | Check that it is empty, has no fullscreen owner and is not the display's last workspace. |

Orchard changes internal Shell methods and moves windows to keep displays
independent. Other extensions that change the same behavior can conflict.
Orchard does not change Kiwi's settings for you.

Ordinary workspace switches follow GNOME's animation settings. Fullscreen
workspace changes are immediate. This avoids a workspace slide during the
application's fullscreen transition.

See the [support policy](GNOME_COMPATIBILITY.md) for tested versions.
See the [validation record](CODE_PRACTICES.md#validation) for recent results and
physical-test limits. For an unresolved problem, follow the
[reporting guide](DEVELOPMENT.md#report-a-problem).
