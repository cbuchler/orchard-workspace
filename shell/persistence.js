// SPDX-License-Identifier: MIT
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

// An immutable epoch scopes serialized window sequence numbers to this Shell.
// Disk state contains UUIDs and window numbers, never GObjects or pool indices.
const layoutSession = GLib.uuid_string_random();
const MAX_DISPLAYS = 32;
const MAX_SLOTS = 64;

function identifier(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
}

export function parseLayout(text) {
    if (!text || text.length > 262144) return null;
    try {
        const state = JSON.parse(text);
        if (state?.version !== 1 || !identifier(state.session) || !Array.isArray(state.displays) ||
            state.displays.length > MAX_DISPLAYS) return null;
        const displays = new Set(), ids = new Set();
        for (const display of state.displays) {
            if (!display || typeof display.key !== 'string' || !display.key || display.key.length > 512 ||
                typeof display.hardware !== 'string' || display.hardware.length > 2048 ||
                !Array.isArray(display.slots) || !display.slots.length || display.slots.length > MAX_SLOTS ||
                !identifier(display.selected)) return null;
            const identity = JSON.stringify([display.key, display.hardware]);
            if (displays.has(identity)) return null;
            displays.add(identity);
            for (const slot of display.slots) {
                if (!identifier(slot?.id) || ids.has(slot.id) || !identifier(slot.binding)) return null;
                if (slot.windows !== undefined && (!Array.isArray(slot.windows) || slot.windows.length > 64 ||
                    slot.windows.some(id => !Number.isInteger(id) || id < 0 || id > 0xffffffff) ||
                    new Set(slot.windows).size !== slot.windows.length)) return null;
                ids.add(slot.id);
            }
            if (!display.slots.some(slot => slot.id === display.selected)) return null;
        }
        return state;
    } catch (_) {
        return null;
    }
}

export class LogicalLayoutPersistence {
    constructor(lifecycle, settings) {
        this.lifecycle = lifecycle;
        this.settings = settings;
        this.state = parseLayout(settings.get_string('logical-layout'));
        this.source = 0;
        this.restoring = false;
        this.restoredStacks = new WeakSet();
        this.workspaceBindings = new WeakMap();
    }

    restore(stacks = [...this.lifecycle.stacks.values()]) {
        if (!this.lifecycle.configuration.automaticSwitchingIsEnabled()) return;
        const connected = [...this.lifecycle.stacks.values()].filter(stack => stack.index !== null);
        // Enabling per-display mode must restore all recognized displays even
        // if they were already connected while restoration was disabled.
        // Already initialized live orders retain their slot/return identities.
        stacks = [...new Set([...stacks, ...connected.filter(stack => !this.restoredStacks.has(stack))])];
        for (const stack of connected) this.restoredStacks.add(stack);
        if (!this.state) return;
        this.restoring = true;
        try {
            const records = this.state.displays;
            const claimed = new Set(connected.filter(stack => !stacks.includes(stack)).map(stack => stack.savedLayout));
            // Exact connector + hardware wins. Hardware-only matching is safe
            // only when both current and saved identities are unambiguous.
            for (const stack of stacks.filter(item => item.index !== null)) {
                // Reconnecting a live stack must not replace objects still
                // referenced by an owner's fullscreen return chain. Lifecycle
                // reconciliation will handle any compositor-driven migration.
                if (stack.order.slots.some(slot => slot.owner) || [...this.lifecycle.windows.values()]
                    .some(state => state.fullscreen?.stack === stack)) continue;
                let saved = records.find(record => !claimed.has(record) && record.key === stack.key &&
                    (!record.hardware || !stack.hardware || record.hardware === stack.hardware));
                if (!saved && stack.hardware) {
                    const candidates = records.filter(record => !claimed.has(record) && record.hardware === stack.hardware);
                    if (candidates.length === 1 && connected.filter(item => item.hardware === stack.hardware).length === 1)
                        [saved] = candidates;
                }
                if (!saved) continue;
                claimed.add(saved);
                // An unambiguous connector change transfers this identity.
                // Do not let its detached runtime stack re-save duplicate IDs.
                for (const [key, other] of this.lifecycle.stacks) {
                    if (other !== stack && other.index === null && other.savedLayout === saved)
                        this.lifecycle.stacks.delete(key);
                }
                stack.savedLayout = saved;
                this._restoreStack(stack, saved);
            }
        } finally {
            this.restoring = false;
        }
    }

    _restoreStack(stack, saved) {
        const lifecycle = this.lifecycle;
        const active = global.workspace_manager.get_active_workspace();
        const present = lifecycle.workspaces();
        const windows = global.get_window_actors().map(actor => actor.get_meta_window())
            .filter(window => window?.get_workspace() && window.get_monitor() === stack.index &&
                !window.is_on_all_workspaces() && !window.is_override_redirect() &&
                ![Meta.WindowType.DESKTOP, Meta.WindowType.DOCK].includes(window.get_window_type()));
        const occupied = new Set(windows.map(window => window.get_workspace()));
        const used = new Set(), assignments = new Map();
        if (this.state.session === layoutSession) {
            for (const entry of saved.slots) {
                // Instance bindings cover reconnects while enabled. Across disable,
                // surviving windows identify occupied backings without retaining
                // Shell objects. Split/moved families use passive reconciliation.
                const anchors = windows.filter(window => entry.windows?.includes(window.get_stable_sequence()));
                const candidates = new Set(anchors.map(window => window.get_workspace()));
                const workspace = present.find(item => this.workspaceBindings.get(item) === entry.binding) ??
                    (candidates.size === 1 ? [...candidates][0] : null);
                if (workspace && !used.has(workspace)) { assignments.set(entry.id, workspace); used.add(workspace); }
            }
        }
        // Keep existing occupied bindings. For a new session, map the selected
        // UUID to the current desktop and remaining occupied desktops in native
        // order. Never move an app to manufacture a historical association.
        if (!used.has(active)) {
            const selected = saved.slots.find(entry => entry.id === saved.selected);
            if (!assignments.has(selected.id)) { assignments.set(selected.id, active); used.add(active); }
        }
        const remaining = present.filter(workspace => occupied.has(workspace) && !used.has(workspace));
        for (const entry of saved.slots) {
            if (!assignments.has(entry.id) && remaining.length) {
                const workspace = remaining.shift(); assignments.set(entry.id, workspace); used.add(workspace);
            }
        }
        // A current desktop selected while Orchard was off must remain visible.
        // If the saved selected slot is already occupied elsewhere, keep both
        // bindings and adopt the current desktop rather than relocating apps.
        stack.order.slots = saved.slots.map(entry => {
            let workspace = assignments.get(entry.id);
            if (!workspace) {
                workspace = lifecycle.workspaces().find(item => !used.has(item) && !occupied.has(item));
                if (!workspace) {
                    global.workspace_manager.append_new_workspace(false, global.get_current_time());
                    workspace = lifecycle.workspaces().at(-1);
                }
                used.add(workspace);
            }
            return {id: entry.id, workspace, owner: null, origin: null, retired: false};
        });
        for (const workspace of new Set([...remaining, ...(used.has(active) ? [] : [active])])) {
            if (!stack.order.workspaces.includes(workspace)) stack.order.insert(stack.order.slots.length, workspace);
        }
        stack.selectedId = stack.order.slots.find(slot => slot.workspace === active)?.id ?? saved.selected;
        // Existing fullscreen windows are new owners with a fresh return path.
        // Saved temporary ownership is never restored.
    }

    save() {
        if (this.restoring || this.source || !this.lifecycle.configuration.automaticSwitchingIsEnabled()) return;
        this.source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.source = 0;
            this.flush();
            return GLib.SOURCE_REMOVE;
        });
    }

    flush() {
        if (this.restoring || !this.lifecycle.configuration.automaticSwitchingIsEnabled()) return;
        if (this.source) { GLib.source_remove(this.source); this.source = 0; }
        const records = [...(this.state?.displays ?? [])];
        const active = global.workspace_manager.get_active_workspace();
        for (const stack of this.lifecycle.stacks.values()) {
            let ordinary = stack.order.slots.filter(slot => !slot.owner && !slot.retired);
            // All ordinary origins may have been explicitly deleted while an
            // owner remains fullscreen. Preserve one desktop as an ordinary
            // fallback, not a stale retired origin or serialized ownership.
            if (!ordinary.length) {
                const fallback = stack.order.slots.find(slot => !slot.retired && slot.workspace === active) ??
                    stack.order.slots.find(slot => !slot.retired);
                if (fallback) ordinary = [fallback];
            }
            if (!ordinary.length || ordinary.length > MAX_SLOTS) continue;
            for (const slot of ordinary) slot.id ??= GLib.uuid_string_random();
            let selected = stack.order.slots.find(slot => slot.workspace === active);
            const seen = new Set();
            while (selected?.owner && !seen.has(selected)) { seen.add(selected); selected = selected.origin; }
            const selectedId = ordinary.includes(selected) ? selected.id :
                ordinary.find(slot => slot.id === stack.selectedId)?.id ?? ordinary[0].id;
            if (stack.index !== null) stack.selectedId = selectedId;
            const record = {key: stack.key, hardware: stack.hardware ?? '', selected: stack.selectedId ?? selectedId,
                slots: ordinary.map(slot => {
                    if (!this.workspaceBindings.has(slot.workspace))
                        this.workspaceBindings.set(slot.workspace, GLib.uuid_string_random());
                    const windows = global.get_window_actors().map(actor => actor.get_meta_window())
                        .filter(window => window?.get_workspace() === slot.workspace && window.get_monitor() === stack.index &&
                            !window.is_on_all_workspaces() && !window.is_override_redirect() &&
                            ![Meta.WindowType.DESKTOP, Meta.WindowType.DOCK].includes(window.get_window_type()))
                        .map(window => window.get_stable_sequence()).slice(0, 64);
                    return {id: slot.id, binding: this.workspaceBindings.get(slot.workspace), windows};
                })};
            // Preserve absent displays, replacing a hardware fallback's former
            // connector record rather than duplicating the same desktop IDs.
            const previous = stack.savedLayout;
            const index = records.findIndex(item => item === previous ||
                (item.key === record.key && item.hardware === record.hardware));
            if (index >= 0) records.splice(index, 1, record); else records.push(record);
            stack.savedLayout = record;
        }
        this.state = {version: 1, session: layoutSession, displays: records.slice(-MAX_DISPLAYS)};
        const value = JSON.stringify(this.state);
        if (value !== this.settings.get_string('logical-layout')) this.settings.set_string('logical-layout', value);
    }

    destroy({save = true} = {}) {
        if (this.source) GLib.source_remove(this.source);
        this.source = 0;
        try {
            if (save) this.flush();
        } finally {
            this.workspaceBindings = null;
            this.restoredStacks = null;
            this.state = null;
            this.lifecycle = null;
            this.settings = null;
        }
    }
}
