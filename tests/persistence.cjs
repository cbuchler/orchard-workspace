// Persistence/reconciliation contract tests with actual lifecycle orders.
// No compositor, runtime objects or physical indices are written to settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function shell(store, epoch) {
    let serial = 0, nextSource = 0;
    const sources = new Map(), workspaces = [], windows = [];
    let monitors = [{index: 0, key: 'eDP-1', hardware: 'panel'}, {index: 1, key: 'HDMI-1', hardware: 'external'}];
    const workspace = () => { const ws = {index: () => workspaces.indexOf(ws), activate() { active = ws; }}; workspaces.push(ws); return ws; };
    for (let i = 0; i < 4; i++) workspace();
    let active = workspaces[0], enabled = true;
    const global = {get_current_time: () => 1, get_window_actors: () => windows.map(window => ({get_meta_window: () => window})),
        workspace_manager: {get_active_workspace: () => active, get_n_workspaces: () => workspaces.length,
            get_workspace_by_index: i => workspaces[i], append_new_workspace: workspace},
        backend: {get_monitor_manager: () => ({get_logical_monitors: () => monitors.map(m => ({
            get_number: () => m.index, get_monitors: () => [{get_connector: () => m.key,
                get_vendor: () => m.hardware, get_product: () => '', get_serial: () => ''}],
        }))})}};
    const ctx = vm.createContext({global, Meta: {WindowType: {NORMAL: 1, DESKTOP: 5, DOCK: 6, DIALOG: 2}},
        GLib: {uuid_string_random: () => `${epoch}-${++serial}`, PRIORITY_DEFAULT_IDLE: 0, SOURCE_REMOVE: false,
            idle_add(_priority, callback) { sources.set(++nextSource, callback); return nextSource; },
            source_remove(id) { assert(sources.delete(id)); }},
        MethodOverrides: class {clear() {}},
    });
    for (const name of ['lifecycle', 'persistence']) vm.runInContext(fs.readFileSync(`shell/${name}.js`, 'utf8')
        .replace(/^import .*;\s*$/gm, '').replace(/^export (class|function) /gm, '$1 '), ctx);
    vm.runInContext('this.api = {LogicalWorkspaceLifecycle, LogicalLayoutPersistence, parseLayout};', ctx);
    const settings = {get_string: key => { assert.equal(key, 'logical-layout'); return store.text ?? ''; },
        set_string(key, value) { assert.equal(key, 'logical-layout'); store.text = value; return true; }};
    const configuration = {automaticSwitchingIsEnabled: () => enabled, conditionallyEnableAutomaticSwitching() {}};
    let lifecycle, persistence;
    function start() {
        lifecycle = new ctx.api.LogicalWorkspaceLifecycle(configuration, {});
        lifecycle.initialize();
        persistence = new ctx.api.LogicalLayoutPersistence(lifecycle, settings);
        lifecycle.persistence = persistence;
        persistence.restore();
        return lifecycle;
    }
    function window(monitor, ws, type = 1) {
        const w = {get_monitor: () => monitor, get_workspace: () => ws, get_window_type: () => type,
            get_transient_for: () => null, is_on_all_workspaces: () => false, is_override_redirect: () => false,
            change_workspace(target) { assert(w.allowMoves, 'restoration must not move windows'); ws = target; }};
        windows.push(w); return w;
    }
    return {start, window, workspaces, windows, sources, parse: ctx.api.parseLayout,
        get lifecycle() { return lifecycle; }, get persistence() { return persistence; },
        select(ws) { active = ws; }, setMonitors(value) { monitors = value; lifecycle?._syncMonitors(); },
        setEnabled(value) { enabled = value; },
        flushIdle() { for (const [id, callback] of [...sources]) { sources.delete(id); callback(); } },
    };
}
// Exact disable/re-enable preserves UUID order, empty desktops and selection,
// including physical index renumbering. Surviving runtime bindings are UUIDs.
{
    const store = {}, s = shell(store, 'same');
    s.window(0, s.workspaces[0]); s.window(1, s.workspaces[0]);
    const first = s.start(), order = first.orderForMonitor(0);
    order.insert(1, s.workspaces[3]); order.insert(2, s.workspaces[1]);
    s.select(s.workspaces[3]); s.persistence.flush();
    const ids = order.slots.map(slot => slot.id), selected = ids[1];
    const bindings = [...order.workspaces];
    first.destroy();
    s.workspaces.reverse();
    const second = s.start();
    assert.deepEqual(Array.from(second.orderForMonitor(0).slots, slot => slot.id), Array.from(ids));
    assert.deepEqual(Array.from(second.orderForMonitor(0).workspaces), bindings);
    assert.equal(second.stackForMonitor(0).selectedId, selected);
    assert(!/"index"|"workspace"|owner|origin/.test(store.text), 'disk representation contains no object/index/fullscreen state');
    second.destroy(); assert.equal(s.sources.size, 0);
}
// A native selection changed while disabled wins over the saved selection.
// Restoration retains both occupied desktops and never moves existing apps.
{
    const store = {}, s = shell(store, 'native-change'), first = s.start();
    first.orderForMonitor(0).insert(1, s.workspaces[1]);
    s.persistence.flush(); first.destroy();
    s.select(s.workspaces[2]); s.window(0, s.workspaces[0]); s.window(0, s.workspaces[2]);
    const second = s.start(), order = second.orderForMonitor(0);
    assert(order.workspaces.includes(s.workspaces[0]) && order.workspaces.includes(s.workspaces[2]));
    assert.equal(new Set(order.workspaces).size, order.slots.length);
    s.persistence.flush();
    const saved = JSON.parse(store.text).displays.find(display => display.key === 'eDP-1');
    assert.equal(saved.selected, order.slots.find(slot => slot.workspace === s.workspaces[2]).id);
    second.destroy();
}
// Dynamic pruning while disabled rebuilds missing empty backings, while new
// occupied desktops are adopted rather than merged or hidden by restoration.
{
    const store = {}, s = shell(store, 'prune'); const first = s.start();
    first.orderForMonitor(0).insert(1, s.workspaces[1]);
    s.persistence.flush(); const ids = Array.from(first.orderForMonitor(0).slots, slot => slot.id); first.destroy();
    s.workspaces.splice(1, 1);
    s.window(0, s.workspaces[2]);
    const second = s.start(), order = second.orderForMonitor(0);
    assert.deepEqual(Array.from(order.slots.slice(0, 2), slot => slot.id), ids);
    assert(order.workspaces.includes(s.workspaces[2]), 'new occupied workspace is retained');
    assert.equal(new Set(order.workspaces).size, order.slots.length);
    second.destroy();
}
// Missing displays keep their saved UUIDs without allocating hidden backings.
// Reconnect can then rebuild the same identity on a different monitor index.
{
    const store = {}, old = shell(store, 'unplug-old'), first = old.start();
    first.orderForMonitor(1).insert(1, old.workspaces[1]); old.persistence.flush(); first.destroy();
    const external = JSON.parse(store.text).displays.find(display => display.key === 'HDMI-1');
    const fresh = shell(store, 'unplug-new'); fresh.setMonitors([{index: 0, key: 'eDP-1', hardware: 'panel'}]);
    fresh.start(); fresh.persistence.flush();
    assert.equal(fresh.workspaces.length, 4, 'absent saved displays do not allocate workspaces');
    assert.deepEqual(JSON.parse(store.text).displays.find(display => display.key === 'HDMI-1').slots, external.slots);
    fresh.setMonitors([{index: 0, key: 'HDMI-1', hardware: 'external'}, {index: 1, key: 'eDP-1', hardware: 'panel'}]);
    assert.deepEqual(Array.from(fresh.lifecycle.orderForMonitor(0).slots, slot => slot.id), external.slots.map(slot => slot.id));
    fresh.lifecycle.destroy();
}
// Two identical displays on changed connectors are ambiguous: preserve their
// saved records but do not assign either layout to an arbitrary display.
{
    const store = {}, old = shell(store, 'identical-old');
    old.setMonitors([{index: 0, key: 'DP-1', hardware: 'identical'}, {index: 1, key: 'DP-2', hardware: 'identical'}]);
    const first = old.start(); first.orderForMonitor(0).insert(1, old.workspaces[1]); old.persistence.flush(); first.destroy();
    const fresh = shell(store, 'identical-new');
    fresh.setMonitors([{index: 0, key: 'DP-3', hardware: 'identical'}, {index: 1, key: 'DP-4', hardware: 'identical'}]);
    fresh.start(); assert.equal(fresh.lifecycle.orderForMonitor(0).slots.length, 1);
    assert.equal(fresh.lifecycle.orderForMonitor(1).slots.length, 1); fresh.persistence.flush();
    assert.equal(JSON.parse(store.text).displays.length, 4, 'ambiguous old displays remain available for exact reconnect');
    fresh.lifecycle.destroy();
}
// A fresh Shell has no old object bindings. Restore selected UUID on the
// current desktop, retain every occupied native desktop, then rebuild empties.
{
    const store = {}, old = shell(store, 'old'); const first = old.start();
    const order = first.orderForMonitor(0); order.insert(1, old.workspaces[1]); order.insert(2, old.workspaces[3]);
    old.select(old.workspaces[3]); old.persistence.flush();
    const ids = Array.from(order.slots, slot => slot.id), selected = ids[2]; first.destroy();
    const fresh = shell(store, 'new'); fresh.window(0, fresh.workspaces[0]); fresh.window(0, fresh.workspaces[2], 2);
    const restored = fresh.start(), next = restored.orderForMonitor(0);
    assert.deepEqual(Array.from(next.slots, slot => slot.id), ids);
    assert.equal(next.slots.find(slot => slot.id === selected).workspace, fresh.workspaces[0]);
    assert(next.workspaces.includes(fresh.workspaces[2]), 'dialog-only desktop is retained');
    assert.equal(next.slots.length, 3); restored.destroy();
}
// A smaller new compositor pool grows only as much as this display's saved
// ordinary desktop count requires, without removing any native workspace.
{
    const store = {}, old = shell(store, 'pool-old'), lifecycle = old.start();
    lifecycle.orderForMonitor(0).insert(1, old.workspaces[1]);
    lifecycle.orderForMonitor(0).insert(2, old.workspaces[2]); old.persistence.flush(); lifecycle.destroy();
    const fresh = shell(store, 'pool-new'); fresh.workspaces.splice(1);
    const restored = fresh.start(); assert.equal(restored.orderForMonitor(0).slots.length, 3);
    assert.equal(fresh.workspaces.length, 3, 'allocate missing backings, not one global pool per display');
    restored.destroy();
}
// Temporary slots/return chains are not restored. Saved selection points at
// a regular ancestor, without serializing the fullscreen owner.
{
    const store = {}, s = shell(store, 'fullscreen'), lifecycle = s.start();
    const order = lifecycle.orderForMonitor(0), origin = order.slots[0];
    const temporary = order.insert(1, s.workspaces[1], {}, origin);
    s.select(temporary.workspace); s.persistence.flush();
    const saved = JSON.parse(store.text).displays.find(display => display.key === 'eDP-1');
    assert.equal(saved.slots.length, 1); assert.equal(saved.selected, origin.id);
    origin.retired = true; order.slots = [temporary]; s.persistence.flush();
    const final = JSON.parse(store.text).displays.find(display => display.key === 'eDP-1');
    assert.equal(final.slots.length, 1); assert.notEqual(final.slots[0].id, origin.id, 'retired final origin is not resurrected');
    lifecycle.destroy(); const restored = s.start();
    assert(restored.orderForMonitor(0).slots.every(slot => slot.owner === null && slot.origin === null));
    restored.destroy();
}
// Display hardware matches a changed connector only when unambiguous; old
// absent identities are retained, and index changes do not exchange layouts.
{
    const store = {}, old = shell(store, 'display'); const lifecycle = old.start();
    lifecycle.orderForMonitor(1).insert(1, old.workspaces[1]); old.persistence.flush();
    const saved = JSON.parse(store.text).displays.find(display => display.key === 'HDMI-1');
    lifecycle.destroy();
    const fresh = shell(store, 'new-display'); fresh.start();
    fresh.setMonitors([{index: 0, key: 'DP-3', hardware: 'external'}, {index: 1, key: 'eDP-1', hardware: 'panel'}]);
    assert.deepEqual(Array.from(fresh.lifecycle.orderForMonitor(0).slots, slot => slot.id), saved.slots.map(slot => slot.id));
    fresh.persistence.flush();
    const records = JSON.parse(store.text).displays;
    assert(!records.some(display => display.key === 'HDMI-1'), 'hardware fallback replaces former connector record');
    assert(records.some(display => display.key === 'eDP-1'));
    fresh.lifecycle.destroy();
}
// Corrupt/unknown versions, duplicate desktop IDs, and unbounded state never
// allocate compositor workspaces; a subsequent save establishes a clean v1.
{
    for (const text of ['', '{broken', '{"version":0}', '{"version":2}', 'x'.repeat(262145)]) {
        const store = {text}, s = shell(store, 'invalid'); const lifecycle = s.start();
        assert.equal(s.workspaces.length, 4); assert.equal(lifecycle.orderForMonitor(0).slots.length, 1);
        s.persistence.flush(); assert(s.parse(store.text)); lifecycle.destroy();
    }
    const store = {}, s = shell(store, 'duplicates'); s.start(); s.persistence.flush();
    const state = JSON.parse(store.text); state.displays[1].slots[0].id = state.displays[0].slots[0].id;
    assert.equal(s.parse(JSON.stringify(state)), null); s.lifecycle.destroy();
}
// Save coalesces repeated changes and drains its owned idle on disable. All-
// displays mode leaves the per-display saved representation untouched.
{
    const store = {}, s = shell(store, 'idle'), lifecycle = s.start();
    lifecycle._changed(); lifecycle._changed(); assert.equal(s.sources.size, 1);
    s.flushIdle(); assert.equal(s.sources.size, 0); assert(s.parse(store.text));
    const saved = store.text; s.setEnabled(false); lifecycle._changed(); assert.equal(s.sources.size, 0);
    lifecycle.destroy(); assert.equal(store.text, saved);
}
// Loading Orchard in all-displays mode must defer, not discard, the saved
// per-display layout. The actual settings handler calls _syncMonitors() when
// enabling that mode with the same displays already connected.
{
    const store = {}, s = shell(store, 'deferred-mode'), first = s.start();
    const order = first.orderForMonitor(0); order.insert(1, s.workspaces[1]); order.insert(2, s.workspaces[3]);
    s.select(s.workspaces[3]); s.window(0, s.workspaces[3]); s.persistence.flush();
    const ids = Array.from(order.slots, slot => slot.id), saved = store.text; first.destroy();
    s.setEnabled(false); const second = s.start();
    assert.equal(second.orderForMonitor(0).slots.length, 1, 'all-displays startup does not restore yet');
    assert.equal(store.text, saved, 'all-displays startup leaves saved layout untouched');
    s.setEnabled(true); second._syncMonitors(); s.persistence.flush();
    assert.deepEqual(Array.from(second.orderForMonitor(0).slots, slot => slot.id), ids);
    assert.equal(JSON.parse(store.text).displays.find(display => display.key === 'eDP-1').selected, ids[2]);
    second.destroy();
}
// Once restored, a mode cycle must retain the live slot objects referenced by
// fullscreen owners. Execute the actual entry/exit paths from a nonfirst origin.
for (const reconnect of [false, true]) {
    const store = {}, s = shell(store, 'live-owner'), lifecycle = s.start();
    const stack = lifecycle.stackForMonitor(0), order = stack.order;
    const origin = order.insert(1, s.workspaces[1]); order.insert(2, s.workspaces[3]);
    const owner = s.window(0, origin.workspace); owner.allowMoves = true; s.select(origin.workspace);
    const state = {window: owner, signals: []}; lifecycle.windows.set(owner, state);
    lifecycle._enterFullscreen(state, stack); s.persistence.flush();
    const temporary = state.fullscreen.slot, before = Array.from(order.slots);
    if (reconnect) {
        s.setMonitors([{index: 1, key: 'HDMI-1', hardware: 'external'}]);
        s.setMonitors([{index: 0, key: 'eDP-1', hardware: 'panel'}, {index: 1, key: 'HDMI-1', hardware: 'external'}]);
    } else {
        s.setEnabled(false); lifecycle._syncMonitors();
        s.setEnabled(true); lifecycle._syncMonitors();
    }
    assert.deepEqual(Array.from(order.slots), before, 'mode/reconnect preserves live fullscreen slot objects');
    assert.equal(state.fullscreen.origin, origin); assert.equal(state.fullscreen.slot, temporary);
    lifecycle._leaveFullscreen(state, true);
    assert.equal(owner.get_workspace(), origin.workspace, 'fullscreen exits to its nonfirst origin');
    assert.equal(origin.workspace, s.workspaces[1]);
    lifecycle.destroy();
}
console.log('PASS: versioned layout persistence, runtime identity/renumbering, pruning, fresh-session occupancy and selection, fullscreen exclusion, display identity and recovery/cleanup');
