// SPDX-License-Identifier: MIT
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Shell binds its native callbacks during startup. Use its handled-boolean
// filter signal instead of replacing registrations owned by Shell/extensions.
export class NativeWorkspaceShortcuts {
    constructor(switcher) {
        this._switcher = switcher;
        this._signal = 0;
    }

    enable() {
        this._signal = global.window_manager.connect('filter-keybinding', (_wm, binding) =>
            this._filter(binding));
    }

    _filter(binding) {
        const match = /^(switch|move)-to-workspace-(left|right|up|down|last|[1-9]\d*)$/.exec(binding.get_name());
        if (!match || !Main.sessionMode.hasWorkspaces ||
            !(Main.actionMode & (Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW)))
            return false;

        const {configuration, resolver, lifecycle, animation} = this._switcher;
        configuration.conditionallyEnableAutomaticSwitching();
        if (!configuration.automaticSwitchingIsEnabled())
            return false;

        const [, action, target] = match;
        const window = action === 'move' ? global.display.focus_window : null;
        if (action === 'move' && (!window?.get_workspace() || window.is_always_on_all_workspaces()))
            return true;

        // A running keyboard slide retains its selected display. Moving a
        // window instead belongs to that window, regardless of pointer position.
        const monitor = window ? window.get_monitor() : animation.selectedMonitor ?? resolver.resolve();
        const stack = lifecycle.stackForMonitor(monitor);
        if (!stack)
            return true;

        const slots = stack.order.slots;
        const active = global.workspace_manager.get_active_workspace();
        let position;
        if (target === 'last') {
            position = slots.length - 1;
        } else if (/^\d+$/.test(target)) {
            position = Number(target) - 1;
        } else {
            const vertical = global.workspace_manager.layout_rows === -1;
            const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
            let step;
            if (vertical && target === 'up') step = -1;
            else if (vertical && target === 'down') step = 1;
            else if (!vertical && target === 'left') step = rtl ? 1 : -1;
            else if (!vertical && target === 'right') step = rtl ? -1 : 1;
            else return true;
            const current = slots.findIndex(slot => slot.workspace === active);
            if (current < 0)
                return true;
            position = current + step;
        }

        const slot = slots[position];
        if (slot && !slot.retired && lifecycle.workspaces().includes(slot.workspace)) {
            if (window)
                Main.wm.actionMoveWindow(window, slot.workspace);
            else
                lifecycle.activate(stack, slot, {animate: true});
        }
        // Consume boundary/invalid-number actions too: native fallback would
        // navigate the physical pool or prepend an unclaimed workspace.
        return true;
    }

    destroy() {
        if (this._signal)
            global.window_manager.disconnect(this._signal);
        this._signal = 0;
    }
}
