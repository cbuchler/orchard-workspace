/* SPDX-License-Identifier: MIT */
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {MethodOverrides} from './methodOverrides.js';

// Logical slots have stable identities independent of the compositor's global
// workspace indices. Different monitors may use different subsets of that pool.
export class LogicalWorkspaceOrder {
    constructor(workspaces = []) {
        this.slots = workspaces.map(workspace => ({workspace, owner: null, origin: null, retired: false}));
    }

    get workspaces() { return this.slots.map(slot => slot.workspace); }

    set workspaces(workspaces) {
        // Native insertion moves contents by physical index. Preserve the
        // existing logical slot identities while remapping their backing.
        this.slots.forEach((slot, i) => { slot.workspace = workspaces[i]; });
    }

    reconcile(workspaces) {
        for (const slot of this.slots) {
            if (!workspaces.includes(slot.workspace)) slot.retired = true;
        }
        this.slots = this.slots.filter(slot => !slot.retired);
    }

    shift(amount, workspaces) {
        this.reconcile(workspaces);
        const count = workspaces.length;
        for (const slot of this.slots) {
            const index = workspaces.indexOf(slot.workspace);
            slot.workspace = workspaces[((index + amount) % count + count) % count];
        }
    }

    insert(position, workspace, owner = null, origin = null) {
        const slot = {workspace, owner, origin, retired: false};
        this.slots.splice(position, 0, slot);
        return slot;
    }
}

export class LogicalWorkspaceLifecycle {
    constructor(configuration, resolver) {
        this.configuration = configuration;
        this.resolver = resolver;
        this.stacks = new Map();
        this.windows = new Map();
        this.signals = [];
        this.pending = new Set();
        this.overrides = new MethodOverrides();
        this.forcedMonitor = null;
        this.pendingActivation = null;
        this.overview = null;
        this.animation = null;
        this.persistence = null;
    }

    workspaces() {
        const manager = global.workspace_manager;
        return Array.from({length: manager.get_n_workspaces()}, (_, i) => manager.get_workspace_by_index(i));
    }

    _monitors() {
        return global.backend.get_monitor_manager().get_logical_monitors().map(monitor => {
            const outputs = monitor.get_monitors();
            const identities = outputs.map(output => [output.get_vendor?.() ?? '', output.get_product?.() ?? '', output.get_serial?.() ?? '']);
            return {index: monitor.get_number(), key: outputs.map(output => output.get_connector()).sort().join('|'),
                hardware: identities.some(parts => parts.some(Boolean)) ? JSON.stringify(identities.sort()) : ''};
        });
    }

    _eligible(window) {
        return window && window.get_workspace() &&
            window.get_window_type() === Meta.WindowType.NORMAL &&
            !window.is_on_all_workspaces() && !window.get_transient_for();
    }

    _allWindows() { return global.get_window_actors().map(actor => actor.get_meta_window()).filter(w => this._eligible(w)); }

    initialize() {
        this._syncMonitors();
        for (const window of this._allWindows()) this._adopt(window);
    }

    _syncMonitors() {
        const restoring = [];
        const connected = new Set([...this.stacks.values()].filter(stack => stack.index !== null));
        for (const stack of this.stacks.values()) stack.index = null;
        const active = global.workspace_manager.get_active_workspace();
        for (const monitor of this._monitors()) {
            let stack = this.stacks.get(monitor.key);
            if (!stack || (stack.hardware && monitor.hardware && stack.hardware !== monitor.hardware)) {
                stack = {key: monitor.key, hardware: monitor.hardware, index: monitor.index, order: new LogicalWorkspaceOrder([active])};
                this.stacks.set(monitor.key, stack);
                restoring.push(stack);
            } else if (!connected.has(stack)) {
                restoring.push(stack);
            }
            stack.index = monitor.index;
            stack.order.reconcile(this.workspaces());
            if (!stack.order.slots.some(slot => slot.workspace === active))
                stack.order.insert(0, active);
        }
        this.persistence?.restore(restoring);
    }

    stackForMonitor(index) { return [...this.stacks.values()].find(stack => stack.index === index); }
    orderForMonitor(index) { return this.stackForMonitor(index)?.order; }

    _slotForWindow(window) {
        const stack = this.stackForMonitor(window.get_monitor());
        if (!stack) return null;
        const workspace = window.get_workspace();
        let slot = stack.order.slots.find(item => item.workspace === workspace);
        if (!slot && this.workspaces().includes(workspace)) slot = stack.order.insert(stack.order.slots.length, workspace);
        return slot;
    }

    _adopt(window) {
        if (!this._eligible(window)) return;
        this._slotForWindow(window);
    }

    _connect(object, signal, callback) {
        const id = object.connect(signal, callback);
        this.signals.push([object, id]);
        return id;
    }

    enable() {
        const lifecycle = this;
        // GNOME 51 no longer consults _blockAnimations in _shouldAnimate().
        // Gate the native decision only during our nonanimated synchronous
        // activation; native shortcuts can keep the native animation decision.
        this.overrides.add(Main.wm, '_shouldAnimate', original => function (...args) {
            return lifecycle.forcedMonitor === null && original.apply(this, args);
        });
        this._protectLogicalSlots();
        this._connect(global.display, 'window-created', (_display, window) => this._watch(window));
        this._connect(global.display, 'window-entered-monitor', (_display, _monitor, window) => this._queue(window));
        this._connect(Main.layoutManager, 'monitors-changed', () => {
            this.animation?.cancel();
            this.overview?.stop();
            this._syncMonitors();
            for (const window of this._allWindows()) this._queue(window);
            this._changed();
        });
        this._connect(global.workspace_manager, 'notify::n-workspaces', () => {
            const workspaces = this.workspaces();
            for (const stack of this.stacks.values()) {
                stack.order.reconcile(workspaces);
                if (stack.index !== null && !stack.order.slots.length)
                    stack.order.insert(0, global.workspace_manager.get_active_workspace());
            }
            for (const window of this._allWindows()) this._adopt(window);
            this._changed();
        });
        for (const window of this._allWindows()) this._watch(window);
        this.persistence?.save();
    }

    _protectLogicalSlots() {
        const tracker = Main.wm._workspaceTracker;
        if (!tracker) return;
        const lifecycle = this;
        this.overrides.add(tracker, '_checkWorkspaces', original => function (...args) {
            if (!lifecycle.configuration.automaticSwitchingIsEnabled()) return original.apply(this, args);
            // Use the check's existing transient-window grace branch locally.
            // No fake timeout ID, global setting, persistent property or paused
            // dynamic-workspace manager is left behind after the synchronous
            // check. Native append/prune still handles unclaimed pool entries.
            const marker = {get_window_type: () => Meta.WindowType.DIALOG};
            const saved = [];
            const present = lifecycle.workspaces();
            for (const workspace of new Set([...lifecycle.stacks.values()].flatMap(stack => stack.order.workspaces))) {
                if (!present.includes(workspace)) continue;
                saved.push([workspace, Object.getOwnPropertyDescriptor(workspace, '_lastRemovedWindow')]);
                workspace._lastRemovedWindow = marker;
            }
            try { return original.apply(this, args); }
            finally {
                for (const [workspace, descriptor] of saved) {
                    if (workspace._lastRemovedWindow !== marker) continue;
                    if (descriptor) Object.defineProperty(workspace, '_lastRemovedWindow', descriptor);
                    else delete workspace._lastRemovedWindow;
                }
            }
        });
        // A callback already bound by Shell must be replaced once; subsequent
        // _queueCheckWorkspaces calls bind the owned wrapper themselves.
        if (tracker._checkWorkspacesId) {
            global.compositor.get_laters().remove(tracker._checkWorkspacesId);
            tracker._checkWorkspacesId = 0;
        }
        tracker._queueCheckWorkspaces();
    }

    _watch(window) {
        if (this.windows.has(window)) return;
        const state = {window, signals: [], source: 0, fullscreen: null};
        this.windows.set(window, state);
        state.signals.push(window.connect('notify::fullscreen', () => this._queue(window)));
        state.signals.push(window.connect('workspace-changed', () => {
            // Retain the state at the event, not only the final state when the
            // idle callback runs. A normal-placement restore during fullscreen
            // exit must not discard our return destination as a user move.
            if (state.fullscreen && window.is_fullscreen())
                state.movedWhileFullscreen = window.get_workspace();
            this._queue(window);
        }));
        state.signals.push(window.connect('unmanaged', () => {
            if (state.source) { GLib.source_remove(state.source); this.pending.delete(state.source); state.source = 0; }
            this.windows.delete(window);
            if (state.fullscreen) this._leaveFullscreen(state, false);
            // The signal owner is being unmanaged; disconnect while it is
            // still valid and never query it from a later callback.
            for (const id of state.signals) window.disconnect(id);
            state.signals = [];
        }));
        this._queue(window);
    }

    _queue(window) {
        const state = this.windows.get(window);
        if (!state) { this._watch(window); return; }
        if (state.source) return;
        state.source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.pending.delete(state.source); state.source = 0;
            this._updateWindow(state);
            return GLib.SOURCE_REMOVE;
        });
        this.pending.add(state.source);
    }

    _updateWindow(state) {
        const {window} = state;
        this.configuration.conditionallyEnableAutomaticSwitching();
        if (!this.configuration.automaticSwitchingIsEnabled() || !this._eligible(window)) return;
        const stack = this.stackForMonitor(window.get_monitor());
        if (!stack) return;
        if (state.fullscreen && state.fullscreen.stack !== stack) {
            // Mutter has already moved the window on monitor hotplug. Preserve
            // that placement, retire its old temporary ownership, then adopt
            // it on the destination monitor without moving it back off-screen.
            this._leaveFullscreen(state, false, false);
        }
        const fullscreen = window.is_fullscreen();
        const movedWhileFullscreen = state.movedWhileFullscreen === window.get_workspace();
        state.movedWhileFullscreen = null;
        if (state.fullscreen && window.get_workspace() !== state.fullscreen.slot.workspace &&
            (fullscreen || movedWhileFullscreen)) {
            this._leaveFullscreen(state, false, false);
            state.suppressedFullscreen = true;
        }
        if (!fullscreen) state.suppressedFullscreen = false;
        if (fullscreen && !state.fullscreen && !state.suppressedFullscreen) this._enterFullscreen(state, stack);
        else if (!fullscreen && state.fullscreen) this._leaveFullscreen(state, true);
        // Adopt the final placement, not an intermediate normal-placement
        // restore that our owned fullscreen return is about to replace.
        this._adopt(window);
        this._changed();
    }

    _freeBacking(stack) {
        const used = new Set(stack.order.workspaces);
        for (const window of this._allWindows()) {
            if (window.get_monitor() === stack.index) used.add(window.get_workspace());
        }
        let workspace = this.workspaces().find(item => !used.has(item));
        if (!workspace) {
            global.workspace_manager.append_new_workspace(false, global.get_current_time());
            workspace = this.workspaces().at(-1);
        }
        return workspace;
    }

    addWorkspace(monitor = this.animation?.selectedMonitor ?? this.resolver.resolve(), activate = true) {
        this.configuration.conditionallyEnableAutomaticSwitching();
        if (!this.configuration.automaticSwitchingIsEnabled()) return null;
        const stack = this.stackForMonitor(monitor);
        if (!stack) return null;
        const slot = stack.order.insert(stack.order.slots.length, this._freeBacking(stack));
        this._changed();
        if (activate) this.activate(stack, slot, {animate: true});
        return slot;
    }

    removeWorkspace(monitor = this.resolver.resolve()) {
        this.configuration.conditionallyEnableAutomaticSwitching();
        if (!this.configuration.automaticSwitchingIsEnabled()) return false;
        const stack = this.stackForMonitor(monitor);
        if (!stack || stack.index === null || stack.order.slots.length <= 1) return false;
        const active = global.workspace_manager.get_active_workspace();
        const position = stack.order.slots.findIndex(slot => slot.workspace === active);
        const slot = stack.order.slots[position];
        if (!slot || slot.owner || slot.retired) return false;
        const occupied = global.get_window_actors().some(actor => {
            const window = actor.get_meta_window();
            return window && window.get_monitor() === monitor && window.get_workspace() === active &&
                !window.is_on_all_workspaces() && !window.is_override_redirect() &&
                ![Meta.WindowType.DESKTOP, Meta.WindowType.DOCK].includes(window.get_window_type());
        });
        if (occupied) return false;

        const target = stack.order.slots[position > 0 ? position - 1 : 1];
        if (target.retired || !this.workspaces().includes(target.workspace)) return false;
        this.animation?.cancel();
        this.activate(stack, target, {animate: true});
        if (global.workspace_manager.get_active_workspace() !== target.workspace) return false;
        // Redirect pending fullscreen returns to the surviving neighbor. Only
        // retire this logical slot: another display may still use its backing.
        slot.origin = target;
        slot.retired = true;
        stack.order.slots.splice(position, 1);
        this._changed();
        return true;
    }

    switchWorkspace(direction) {
        const stack = this.stackForMonitor(this.animation?.selectedMonitor ?? this.resolver.resolve());
        if (!stack) return;
        const active = global.workspace_manager.get_active_workspace();
        const current = stack.order.slots.findIndex(slot => slot.workspace === active);
        const slot = stack.order.slots[current + direction];
        if (slot) this.activate(stack, slot, {animate: true});
    }

    activate(stack, slot, {animate = false, focusWindow = null} = {}) {
        if (stack.index === null || slot.retired || !this.workspaces().includes(slot.workspace)) return;
        const animatedMonitor = this.animation?.selectedMonitor;
        if (!animate || (animatedMonitor != null && animatedMonitor !== stack.index)) this.animation?.cancel();
        this.overview?._session?.navigation?.cancel();
        const workspace = slot.workspace;
        if (workspace === global.workspace_manager.get_active_workspace()) {
            if (focusWindow?.get_workspace() === workspace)
                focusWindow.activate(global.get_current_time());
            return;
        }
        const activation = {stack, workspace};
        this.pendingActivation = activation;
        const previousMonitor = this.forcedMonitor;
        const resolver = this.resolver;
        const previousNavigation = resolver.navigation;
        resolver.navigation = {monitor: stack.index, workspace};
        if (!animate) this.forcedMonitor = stack.index;
        try {
            const timestamp = global.get_current_time();
            if (focusWindow?.get_workspace() === workspace)
                workspace.activate_with_focus(focusWindow, timestamp);
            else
                workspace.activate(timestamp);
        }
        catch (error) {
            if (this.pendingActivation === activation) this.pendingActivation = null;
            throw error;
        } finally {
            this.forcedMonitor = previousMonitor;
            resolver.navigation = this.resolver === resolver ? previousNavigation : null;
        }
    }

    takeActivationMonitor(workspace) {
        const activation = this.pendingActivation;
        this.pendingActivation = null;
        // Workspace notification delivery need not share the caller's JS
        // stack. Match the owned target instead of a later pointer position.
        return activation?.workspace === workspace ? activation.stack.index : null;
    }

    _focusedFamilyMember(window) {
        const focused = global.display.focus_window;
        for (let parent = focused; parent; parent = parent.get_transient_for()) {
            if (parent === window) return focused;
        }
        return null;
    }

    _enterFullscreen(state, stack) {
        const origin = this._slotForWindow(state.window);
        if (!origin) return;
        // Moving the focused window off the active workspace lets Mutter focus
        // an unrelated window. Preserve its focus through the workspace change.
        const focusWindow = this._focusedFamilyMember(state.window);
        const workspace = this._freeBacking(stack);
        const position = stack.order.slots.indexOf(origin) + 1;
        const slot = stack.order.insert(position, workspace, state.window, origin);
        state.fullscreen = {stack, slot, origin};
        state.window.change_workspace(slot.workspace);
        this.activate(stack, slot, {focusWindow});
    }

    _returnSlot(stack, origin, excluded = null) {
        const fallback = () => stack.order.slots.find(slot => slot !== excluded && !slot.retired);
        const seen = new Set();
        while (origin && (origin === excluded || origin.retired || !stack.order.slots.includes(origin))) {
            if (seen.has(origin)) return fallback();
            seen.add(origin); origin = origin.origin;
        }
        return origin ?? fallback();
    }

    _leaveFullscreen(state, moveWindow, activateReturn = true) {
        const {stack, slot, origin} = state.fullscreen;
        const focusWindow = moveWindow ? this._focusedFamilyMember(state.window) : null;
        state.fullscreen = null;
        const target = this._returnSlot(stack, origin, slot);
        const destination = target ?? slot;
        const wasActive = slot.workspace === global.workspace_manager.get_active_workspace();
        if (moveWindow && this.workspaces().includes(destination.workspace)) {
            state.window.change_workspace(destination.workspace);
        }
        const occupied = this._allWindows().some(window => window !== state.window &&
            window.get_monitor() === stack.index && window.get_workspace() === slot.workspace);
        if (!occupied && target) {
            slot.retired = true;
            stack.order.slots = stack.order.slots.filter(item => item !== slot);
        } else {
            // Keep occupied temporary desktops, or the final desktop when all
            // of its ordinary return destinations were explicitly removed.
            slot.owner = null;
            if (!target) slot.origin = null;
        }
        if (wasActive && target && activateReturn && stack.index !== null)
            this.activate(stack, target, {focusWindow});
        this._changed();
    }

    _changed() {
        this.overview?.syncLogicalOrders();
        this.persistence?.save();
    }

    destroy() {
        this.persistence?.destroy();
        this.persistence = null;
        for (const source of this.pending) GLib.source_remove(source);
        this.pending.clear();
        for (const state of this.windows.values()) {
            for (const id of state.signals) state.window.disconnect(id);
        }
        this.windows.clear();
        for (const [object, id] of this.signals) object.disconnect(id);
        this.signals = [];
        this.overrides.clear();
        // Do not remove Meta.Workspaces or relocate any windows on disable.
        this.stacks.clear();
        this.overview = null;
        this.animation = null;
        this.forcedMonitor = null;
        this.pendingActivation = null;
        this.resolver.navigation = null;
        this.configuration = null;
        this.resolver = null;
    }
}
