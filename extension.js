/*
 * Orchard Workspace
 *
 * Based on Active Monitor Workspaces by IndyDevGuy and
 * gnome-shell-extension-simulate-switching-workspaces-on-active-monitor.
 * Copyright (c) 2019 Xiaoguang Wang
 * Copyright (c) 2026 IndyDevGuy
 * Distributed under the MIT License; see LICENSE.
 */

// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {MonitorResolver, ConfigurationService} from './shell/monitor.js';
import {MonitorWorkspaceAnimation} from './shell/animation.js';
import {OverviewWorkspaceIsolation} from './shell/overview.js';
import {WorkspaceSwitcher} from './shell/switcher.js';
import {LogicalWorkspaceLifecycle} from './shell/lifecycle.js';

const PREVIOUS = 'switch-active-display-previous';
const NEXT = 'switch-active-display-next';
const ADD = 'add-active-display-workspace';

export default class SwitchWorkspacesExtension extends Extension {
    enable() {
        const settings = this.getSettings();
        const configuration = new ConfigurationService(settings);
        const resolver = new MonitorResolver();
        configuration.conditionallyEnableAutomaticSwitching();
        const lifecycle = new LogicalWorkspaceLifecycle(configuration, resolver);
        lifecycle.initialize();
        const animation = new MonitorWorkspaceAnimation(
            Main.wm._workspaceAnimation, configuration, resolver, lifecycle);
        const overview = new OverviewWorkspaceIsolation(configuration, resolver, lifecycle);
        const switcher = new WorkspaceSwitcher(configuration, resolver, animation, overview, lifecycle);
        lifecycle.overview = overview;
        lifecycle.animation = animation;
        this._state = {settings, configuration, animation, overview, switcher, lifecycle, signals: [], bindings: []};

        try {
            animation.enable();
            overview.enable();
            for (const [name, direction] of [[PREVIOUS, -1], [NEXT, 1]]) {
                Main.wm.addKeybinding(name, settings, Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.NORMAL, () => switcher.switchWorkspace(direction));
                this._state.bindings.push(name);
            }
            Main.wm.addKeybinding(ADD, settings, Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => lifecycle.addWorkspace());
            this._state.bindings.push(ADD);
            const connect = (object, signal, callback) => {
                this._state.signals.push([object, object.connect(signal, callback)]);
            };
            connect(global.workspace_manager, 'active-workspace-changed', () => {
                configuration.conditionallyEnableAutomaticSwitching();
                switcher.onGlobalWorkspaceChanged();
            });
            connect(Main.layoutManager, 'monitors-changed', () => {
                animation.cancel();
                overview.stop();
            });
            connect(settings, 'changed::active-monitor-only', () => {
                animation.cancel();
                configuration.conditionallyEnableAutomaticSwitching();
                switcher.syncActiveWorkspace();
                lifecycle._syncMonitors();
                overview.syncLogicalOrders();
                overview.refresh();
                for (const window of lifecycle.windows.keys()) lifecycle._queue(window);
            });
            lifecycle.enable();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    disable() {
        if (!this._state) return;
        const state = this._state;
        this._state = null;
        for (const [object, id] of state.signals)
            object.disconnect(id);
        for (const name of state.bindings)
            Main.wm.removeKeybinding(name);
        state.lifecycle.destroy();
        state.overview.destroy();
        state.animation.destroy();
    }
}
