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

export class WorkspaceSwitcher {
    constructor(configuration, resolver, animation, overview = null, lifecycle = null) {
        this.configuration = configuration;
        this.resolver = resolver;
        this.animation = animation;
        this.overview = overview;
        this.lifecycle = lifecycle;
        this.syncActiveWorkspace();
    }

    syncActiveWorkspace() {
        const manager = global.workspace_manager;
        this.activeIndex = manager.get_active_workspace_index();
        this.activeWorkspace = manager.get_workspace_by_index(this.activeIndex);
    }

    movableWindows() {
        return global.get_window_actors()
            .map(actor => actor.get_meta_window())
            .filter(window => window && window.get_workspace() &&
                window.get_window_type() === Meta.WindowType.NORMAL &&
                !window.is_on_all_workspaces());
    }

    moveWindow(window, shift) {
        const count = global.workspace_manager.get_n_workspaces();
        const index = window.get_workspace().index();
        const target = ((index + shift) % count + count) % count;
        const move = () => window.change_workspace_by_index(target, false);
        if (this.overview)
            this.overview.moveWithoutPreviewAnimation(window, target, move);
        else
            move();
    }

    onGlobalWorkspaceChanged() {
        const manager = global.workspace_manager;
        const index = manager.get_active_workspace_index();
        const workspace = manager.get_workspace_by_index(index);
        const previous = this.activeWorkspace;
        const workspaces = Array.from({length: manager.get_n_workspaces()}, (_, i) => manager.get_workspace_by_index(i));
        const previousIndex = previous ? workspaces.indexOf(previous) : this.activeIndex;
        this.activeIndex = index;
        this.activeWorkspace = workspace;
        const activationMonitor = this.lifecycle?.takeActivationMonitor(workspace);

        // GNOME can renumber the same workspace when it removes an empty one.
        if (this.overview?.insertingWorkspace || previous === workspace || previousIndex < 0 ||
            !this.configuration.automaticSwitchingIsEnabled()) {
            this.overview?.syncActiveWorkspace();
            return;
        }

        const monitor = activationMonitor ?? this.lifecycle?.forcedMonitor ?? this.animation.selectedMonitor ?? this.overview?.selectedMonitor ?? this.resolver.resolve();
        if (this.lifecycle) {
            const order = this.lifecycle.orderForMonitor(monitor);
            if (order && !order.workspaces.includes(workspace)) order.insert(order.slots.length, workspace);
        }
        const shift = index - previousIndex;
        for (const window of this.movableWindows()) {
            if (window.get_monitor() !== monitor)
                this.moveWindow(window, shift);
        }
        this.overview?.shiftWorkspaceOrder(monitor, shift);
        this.overview?.syncActiveWorkspace();
    }

    switchWorkspace(direction) {
        this.configuration.conditionallyEnableAutomaticSwitching();
        if (!this.configuration.automaticSwitchingIsEnabled()) {
            const manager = global.workspace_manager;
            const workspace = manager.get_workspace_by_index(manager.get_active_workspace_index());
            const vertical = manager.layout_rows === -1;
            const motion = direction < 0
                ? (vertical ? Meta.MotionDirection.UP : Meta.MotionDirection.LEFT)
                : (vertical ? Meta.MotionDirection.DOWN : Meta.MotionDirection.RIGHT);
            const target = workspace.get_neighbor(motion);
            if (target && target !== workspace)
                target.activate(global.get_current_time());
            return;
        }

        if (this.lifecycle) {
            this.lifecycle.switchWorkspace(direction);
            return;
        }
        const monitor = this.resolver.resolve();
        for (const window of this.movableWindows()) {
            if (window.get_monitor() === monitor)
                this.moveWindow(window, -direction);
        }
        this.overview?.shiftWorkspaceOrder(monitor, -direction, false);
    }
}
