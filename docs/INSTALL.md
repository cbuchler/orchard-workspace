# Install Orchard Workspace

[Back to the README](../README.md)

## Requirements

- GNOME Shell 50 or 51.
- The `gnome-extensions` command.

Node.js and npm are development tools. You do not need them to install or run
Orchard. See the [support policy](GNOME_COMPATIBILITY.md) for tested versions and
known limits.

If you use Kiwi, turn off **Move Window to New Workspace** before you enable
Orchard. Disable other copies of Active Monitor Workspaces.

## Download and install

1. Download `orchard-workspace@cbuchler.github.io.shell-extension.zip` from the
   [latest release](https://github.com/cbuchler/orchard-workspace/releases/latest).
2. Open a terminal in the folder that contains the ZIP file.
3. Install the package:

   ```sh
   gnome-extensions install orchard-workspace@cbuchler.github.io.shell-extension.zip
   ```

4. On Wayland, log out.
5. On Wayland, log in again.
6. Open **Settings → Multitasking**.
7. Select **Workspaces on all displays**.
8. Open the Extensions app.
9. Enable **Orchard Workspace**.

To open Orchard's preferences, run:

```sh
gnome-extensions prefs orchard-workspace@cbuchler.github.io
```

## Update

1. Download the new ZIP file from the release page.
2. Open a terminal in the folder that contains the ZIP file.
3. Replace the installed package:

   ```sh
   gnome-extensions install --force orchard-workspace@cbuchler.github.io.shell-extension.zip
   ```

4. On Wayland, log out.
5. On Wayland, log in again to load the new code.

Replacing files does not reload JavaScript in a running Wayland Shell session.

## Disable or remove

To disable Orchard, run:

```sh
gnome-extensions disable orchard-workspace@cbuchler.github.io
```

Orchard leaves windows where they are. GNOME resumes its normal workspace
behavior. In dynamic mode, GNOME can remove empty workspaces.

To remove the installed extension, run:

```sh
gnome-extensions uninstall orchard-workspace@cbuchler.github.io
```

## Check the installation

Run:

```sh
gnome-extensions info orchard-workspace@cbuchler.github.io
```

Check the extension state and any reported error. An active state confirms
startup; it does not confirm that every workspace action works.

See [Troubleshooting](USAGE.md#troubleshooting) if switching does not work as expected.

## Build from source

Use this method to install a source checkout. You also need Git to download it.

1. Get the source:

   ```sh
   git clone https://github.com/cbuchler/orchard-workspace.git
   cd orchard-workspace
   ```

   If you already have the source, open a terminal in its root directory.

2. Create the extension package:

   ```sh
   mkdir -p dist
   gnome-extensions pack --force --extra-source=LICENSE --extra-source=shell --out-dir=dist .
   ```

3. Install the package:

   ```sh
   gnome-extensions install dist/orchard-workspace@cbuchler.github.io.shell-extension.zip
   ```

   For an existing installation, add `--force` after `install`.

4. Complete steps 4–9 in [Download and install](#download-and-install).

To update from source, get the revision you want. Repeat the package and install
steps. On Wayland, log out. Log in again to load the new code.
