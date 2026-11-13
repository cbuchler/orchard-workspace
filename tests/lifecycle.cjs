// Model and real GNOME 51 dynamic-check tests. No compositor or live rendering.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class Signals {
    constructor() { this.handlers = new Map(); this.next = 1; }
    connect(name, callback) { const id = this.next++; this.handlers.set(id, {name, callback}); return id; }
    disconnect(id) { assert(this.handlers.delete(id)); }
    emit(name, ...args) { for (const [id, handler] of [...this.handlers]) if (this.handlers.has(id) && handler.name === name) handler.callback(this, ...args); }
}
function setup(dynamic = true, deferredActivation = false) {
    let monitors = [{index: 0, key: 'eDP-1'}, {index: 1, key: 'HDMI-1'}], selected = 0, active, enabled = true;
    const windows = [], workspaces = [], sources = new Map(), animationDecisions = []; let nextSource = 1;
    const manager = Object.assign(new Signals(), {
        get_n_workspaces: () => workspaces.length, get n_workspaces() { return workspaces.length; },
        get_active_workspace: () => active, get_active_workspace_index: () => workspaces.indexOf(active),
        get_workspace_by_index: i => workspaces[i],
        append_new_workspace() { const ws = makeWorkspace(); workspaces.push(ws); this.emit('notify::n-workspaces'); return ws; },
        remove_workspace(ws) { assert(!windows.some(w => w.workspace === ws)); workspaces.splice(workspaces.indexOf(ws), 1); this.emit('notify::n-workspaces'); },
    });
    Object.defineProperty(manager, 'n_workspaces', {get: () => workspaces.length});
    function makeWorkspace() {
        const ws = {index: () => { assert(workspaces.includes(ws)); return workspaces.indexOf(ws); },
            activate() { if (active === ws) return; active = ws; animationDecisions.push(Main.wm._shouldAnimate());
                if (deferredActivation) { const id = nextSource++; sources.set(id, () => { manager.emit('active-workspace-changed'); return false; }); }
                else manager.emit('active-workspace-changed'); }};
        Object.defineProperty(ws, 'active', {get: () => ws === active}); return ws;
    }
    for (let i = 0; i < 4; i++) workspaces.push(makeWorkspace()); active = workspaces[0];
    const display = new Signals(), layout = new Signals();
    const Main = {layoutManager: layout, overview: {visible: false}, wm: {_workspaceAnimation: {gestureActive: false}}};
    const global = {workspace_manager: manager, workspaceManager: manager, display,
        get_window_actors: () => windows.map(window => ({get_meta_window: () => window})),
        get_current_time: () => 1,
        backend: {get_monitor_manager: () => ({get_logical_monitors: () => monitors.map(m => ({
            get_number: () => m.index, get_monitors: () => [{get_connector: () => m.key}],
        }))})},
        compositor: {get_laters: () => ({remove: id => sources.delete(id), add(_type, callback) {
            const id = nextSource++; sources.set(id, callback); return id;
        }})},
    };
    const GLib = {PRIORITY_DEFAULT_IDLE: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
        idle_add(_priority, callback) { const id = nextSource++; sources.set(id, callback); return id; },
        source_remove(id) { assert(sources.delete(id)); }};
    const Meta = {WindowType: {NORMAL: 1, DIALOG: 2, SPLASHSCREEN: 3, MODAL_DIALOG: 4},
        LaterType: {BEFORE_REDRAW: 0}, prefs_get_dynamic_workspaces: () => dynamic};
    const ctx = vm.createContext({Main, global, GLib, Meta, MIN_NUM_WORKSPACES: 2,
        Shell: {WindowTracker: {get_default: () => ({get_startup_sequences: () => []})}}});
    for (const file of ['shell/methodOverrides.js', 'shell/lifecycle.js', 'shell/switcher.js', 'shell/overview.js'])
        vm.runInContext(fs.readFileSync(file, 'utf8').replace(/^import .*;\s*$/gm, '').replace(/^export class /gm, 'class '), ctx);
    vm.runInContext('this.Lifecycle = LogicalWorkspaceLifecycle; this.Switcher = WorkspaceSwitcher; this.Isolation = OverviewWorkspaceIsolation;', ctx);
    const native = fs.readFileSync(process.env.ORCHARD_WM_SOURCE, 'utf8');
    const shouldStart = native.indexOf('    _shouldAnimate() {'), shouldEnd = native.indexOf('\n    }\n', shouldStart);
    Main.wm._shouldAnimate = vm.runInContext(`({${native.slice(shouldStart, shouldEnd + 6)}})._shouldAnimate`, ctx);
    const start = native.indexOf('    _checkWorkspaces() {'), end = native.indexOf('\n    }\n', start);
    const check = vm.runInContext(`({${native.slice(start, end + 6)}})._checkWorkspaces`, ctx);
    const tracker = {_checkWorkspaces: check, _checkWorkspacesId: 0, _pauseWorkspaceCheck: false,
        _queueCheckWorkspaces() { if (!this._checkWorkspacesId) this._checkWorkspacesId = global.compositor.get_laters().add(0, this._checkWorkspaces.bind(this)); }};
    Object.defineProperty(tracker, '_workspaces', {get: () => workspaces}); Main.wm._workspaceTracker = tracker;
    const config = {automaticSwitchingIsEnabled: () => enabled, conditionallyEnableAutomaticSwitching() {}};
    const resolver = {resolve: () => selected};
    const lifecycle = new ctx.Lifecycle(config, resolver);
    lifecycle.initialize();
    // Use the real overview owner while the overview has never been opened.
    // Its constructor must already bind logical orders for desktop compensation.
    const overview = new ctx.Isolation(config, resolver, lifecycle);
    lifecycle.overview = overview;
    const switcher = new ctx.Switcher(config, resolver, {selectedMonitor: null}, overview, lifecycle);
    manager.connect('active-workspace-changed', () => switcher.onGlobalWorkspaceChanged());
    function makeWindow(monitor, workspace = active) {
        const window = Object.assign(new Signals(), {monitor, workspace, fullscreen: false, destroyed: false,
            get_monitor() { assert(!this.destroyed); return this.monitor; }, get_workspace() { assert(!this.destroyed); return this.workspace; },
            get_window_type: () => 1, get_transient_for: () => null, is_on_all_workspaces: () => false,
            is_fullscreen() { return this.fullscreen; },
            change_workspace(ws) { assert(!this.destroyed); this.workspace = ws; this.emit('workspace-changed'); },
            change_workspace_by_index(index) { this.change_workspace(workspaces[index]); },
        });
        windows.push(window); return window;
    }
    function flush() { for (let i = 0; sources.size && i < 30; i++) for (const [id, callback] of [...sources]) { if (!sources.has(id)) continue; sources.delete(id); if (callback()) sources.set(id, callback); } assert.equal(sources.size, 0); }
    function toggle(window, fullscreen) { window.fullscreen = fullscreen; window.emit('notify::fullscreen'); flush(); }
    return {lifecycle, workspaces, windows, manager, display, layout, tracker, makeWindow, flush, toggle, Main, animationDecisions,
        choose(index) { selected = index; }, active: () => active, setMonitors(value) { monitors = value; layout.emit('monitors-changed'); },
        enable() { lifecycle.initialize(); lifecycle.enable(); flush(); }, sources};
}
for (const dynamic of [false, true]) {
    const s = setup(dynamic); const left = s.makeWindow(0), right = s.makeWindow(1);
    s.enable();
    assert.equal(s.lifecycle.orderForMonitor(0).slots.length, 1, 'clean primary starts with one logical workspace');
    assert.equal(s.lifecycle.orderForMonitor(1).slots.length, 1, 'clean secondary starts with one logical workspace');
    const oldPhysical = [...s.workspaces];
    const rightBase = s.lifecycle.orderForMonitor(1).slots[0];
    const slot = s.lifecycle.addWorkspace(0); s.flush();
    assert.equal(s.lifecycle.orderForMonitor(0).slots.length, 2);
    assert.equal(s.lifecycle.orderForMonitor(1).slots.length, 1, 'manual expansion affects only selected monitor');
    assert.equal(right.workspace, rightBase.workspace); assert.equal(right.workspace, s.active(), 'inactive monitor keeps its visible window');
    for (let i = 0; i < 4; i++) s.lifecycle.addWorkspace(0, false);
    s.flush(); assert.equal(s.lifecycle.orderForMonitor(0).slots.length, 6);
    assert(s.workspaces.length >= 6, 'backing pool grows in fixed and dynamic modes without changing settings');
    s.tracker._checkWorkspaces();
    assert.equal(s.lifecycle.orderForMonitor(0).slots.length, 6, 'empty manual slots survive native dynamic check');
    assert(s.workspaces.every(ws => !Object.hasOwn(ws, '_lastRemovedWindow')), 'retention markers never leak out of native check');
    s.choose(1); const primaryOrder = s.lifecycle.orderForMonitor(0);
    const currentPrimary = primaryOrder.slots.find(item => item.workspace === s.active());
    const origin = s.lifecycle.orderForMonitor(1).slots.find(item => item.workspace === right.workspace);
    s.toggle(right, true);
    const fullscreenSlot = s.lifecycle.windows.get(right).fullscreen.slot;
    assert.notEqual(fullscreenSlot, origin); assert.equal(fullscreenSlot.workspace, right.workspace);
    assert.equal(right.workspace, s.active()); assert.equal(currentPrimary.workspace, s.active());
    assert.equal(s.lifecycle.orderForMonitor(1).slots.length, 2);
    const nested = s.makeWindow(1); s.display.emit('window-created', nested); s.flush(); s.toggle(nested, true);
    const nestedSlot = s.lifecycle.windows.get(nested).fullscreen.slot;
    assert.equal(nestedSlot.origin, fullscreenSlot);
    assert.equal(s.lifecycle.orderForMonitor(1).slots.length, 3);
    s.toggle(right, false);
    assert.equal(right.workspace, origin.workspace); assert.equal(fullscreenSlot.retired, true);
    assert.equal(nested.workspace, nestedSlot.workspace);
    s.toggle(nested, false);
    assert.equal(nested.workspace, origin.workspace, 'return chain skips already retired fullscreen slot');
    assert.equal(s.lifecycle.orderForMonitor(1).slots.length, 1);
    // A user-populated temporary slot is retained rather than deleting or
    // relocating unrelated windows when its fullscreen owner exits.
    s.toggle(right, true); const retained = s.lifecycle.windows.get(right).fullscreen.slot;
    const other = s.makeWindow(1, retained.workspace); s.display.emit('window-created', other); s.flush();
    s.toggle(right, false); assert.equal(retained.retired, false); assert.equal(other.workspace, retained.workspace);
    // Explicit user movement of a fullscreen window relinquishes automation;
    // its later unfullscreen event must not undo that new placement.
    s.toggle(right, true);
    const movedTarget = s.lifecycle.orderForMonitor(1).slots.find(item => item.workspace !== right.workspace);
    right.change_workspace(movedTarget.workspace); s.flush();
    assert.equal(s.lifecycle.windows.get(right).fullscreen, null);
    s.toggle(right, false); assert.equal(right.workspace, movedTarget.workspace);
    // A queued fullscreen change is cancelled on disable without moving it.
    const pending = s.makeWindow(0); s.display.emit('window-created', pending); pending.fullscreen = true;
    const positions = new Map(s.windows.map(w => [w, w.workspace]));
    const workspaceCount = s.workspaces.length;
    s.lifecycle.destroy();
    assert.equal(s.sources.size, 0);
    assert.equal(s.workspaces.length, workspaceCount, 'disable does not remove physical workspaces');
    for (const [window, workspace] of positions) assert.equal(window.workspace, workspace, 'disable preserves actual window placement');
    assert(s.windows.every(w => w.handlers.size === 0));
    assert.equal(s.display.handlers.size, 0); assert.equal(s.layout.handlers.size, 0);
    assert(s.animationDecisions.every(value => value === false), 'native GNOME animation gate suppresses only Orchard activations');
    assert.equal(s.Main.wm._shouldAnimate(), true, 'disable restores native animation decision');
}
// Fullscreen belongs immediately after its stable origin, even when that
// origin is hidden or the pointer is on another display. Inserting/removing
// the temporary slot must leave every unrelated logical identity in place.
for (const dynamic of [false, true]) for (const monitor of [0, 1]) {
    for (const originIndex of [0, 1, 2]) for (const activeOrigin of [false, true]) {
        const s = setup(dynamic), win = s.makeWindow(monitor), other = s.makeWindow(1 - monitor);
        s.enable();
        const stack = s.lifecycle.stackForMonitor(monitor), order = stack.order;
        s.lifecycle.addWorkspace(monitor, false); s.lifecycle.addWorkspace(monitor, false);
        const before = [...order.slots], origin = before[originIndex];
        win.change_workspace(origin.workspace); s.flush();
        s.lifecycle.activate(stack, before[activeOrigin ? originIndex : (originIndex + 1) % before.length]);
        s.flush();
        const otherOrder = s.lifecycle.orderForMonitor(1 - monitor);
        const otherSlots = [...otherOrder.slots];
        const otherActive = otherSlots.find(slot => slot.workspace === s.active());
        s.choose(1 - monitor); s.toggle(win, true);
        const temporary = s.lifecycle.windows.get(win).fullscreen.slot;
        assert.equal(temporary.origin, origin);
        assert.deepEqual(Array.from(order.slots), [...before.slice(0, originIndex + 1), temporary, ...before.slice(originIndex + 1)],
            'fullscreen inserts after first/middle/last origin without moving unrelated slots');
        assert.equal(win.workspace, temporary.workspace);
        assert.equal(s.active(), temporary.workspace);
        assert.deepEqual(Array.from(otherOrder.slots), otherSlots, 'other display keeps its logical order');
        assert.equal(otherActive.workspace, s.active());
        assert.equal(other.workspace, s.active(), 'other display keeps its visible window');
        assert.equal(s.lifecycle.overview._orders.get(monitor), order, 'overview uses the updated logical order');
        s.toggle(win, false);
        assert.deepEqual(Array.from(order.slots), before, 'fullscreen exit restores the original logical sequence');
        assert.equal(win.workspace, origin.workspace);
        assert.equal(s.active(), origin.workspace);
        assert.equal(temporary.retired, true);
        assert.equal(otherActive.workspace, s.active());
        s.lifecycle.destroy();
    }
}
// A nested fullscreen slot follows its fullscreen origin, not the end of the
// list. Retiring an inactive outer owner leaves the inner slot selected and
// its return chain skips the retired slot without disturbing regular slots.
for (const dynamic of [false, true]) {
    const s = setup(dynamic), outer = s.makeWindow(0); s.makeWindow(1); s.enable();
    const stack = s.lifecycle.stackForMonitor(0), order = stack.order;
    s.lifecycle.addWorkspace(0, false); s.lifecycle.addWorkspace(0, false);
    const before = [...order.slots], origin = before[1];
    outer.change_workspace(origin.workspace); s.flush(); s.lifecycle.activate(stack, origin); s.flush();
    s.toggle(outer, true);
    const outerSlot = s.lifecycle.windows.get(outer).fullscreen.slot;
    const inner = s.makeWindow(0); s.display.emit('window-created', inner); s.flush(); s.toggle(inner, true);
    const innerSlot = s.lifecycle.windows.get(inner).fullscreen.slot;
    assert.deepEqual(Array.from(order.slots), [before[0], origin, outerSlot, innerSlot, before[2]]);
    s.toggle(outer, false);
    assert.equal(s.active(), innerSlot.workspace, 'inactive fullscreen owner must not pull focus from its child');
    assert.deepEqual(Array.from(order.slots), [before[0], origin, innerSlot, before[2]]);
    s.toggle(inner, false);
    assert.deepEqual(Array.from(order.slots), before);
    assert.equal(inner.workspace, origin.workspace);
    assert.equal(s.active(), origin.workspace);
    // If another window occupies the temporary slot, retain it in its original
    // adjacent position after the fullscreen owner returns.
    s.toggle(outer, true);
    const retained = s.lifecycle.windows.get(outer).fullscreen.slot;
    const occupant = s.makeWindow(0, retained.workspace); s.display.emit('window-created', occupant); s.flush();
    s.toggle(outer, false);
    assert.deepEqual(Array.from(order.slots), [before[0], origin, retained, before[2]]);
    assert.equal(retained.retired, false);
    assert.equal(retained.owner, null);
    assert.equal(occupant.workspace, retained.workspace);
    s.lifecycle.destroy();
}
console.log('PASS: adjacent fullscreen insertion at first/middle/last origins on both displays, hidden origins, nested returns and retained occupied slots');

// Import occupied existing workspaces without merging windows or deleting
// physical workspaces merely to obtain a one-slot visual default.
{
    const s = setup(false); const existing = s.makeWindow(0, s.workspaces[2]);
    s.enable(); assert.equal(s.lifecycle.orderForMonitor(0).slots.length, 2);
    assert.equal(existing.workspace, s.workspaces[2]); assert.equal(s.lifecycle.orderForMonitor(1).slots.length, 1);
    s.lifecycle.destroy();
}
// Connector identity survives index changes; a fullscreen window migrated by
// Mutter on unplug is adopted on its new monitor without moving it off-screen.
{
    const s = setup(true); const win = s.makeWindow(1); s.enable(); s.toggle(win, true);
    const oldStack = s.lifecycle.stackForMonitor(1); win.monitor = 0;
    s.setMonitors([{index: 0, key: 'eDP-1'}]); s.flush();
    assert.equal(oldStack.index, null);
    assert.equal(win.monitor, 0);
    assert.equal(s.lifecycle.windows.get(win).fullscreen.stack.index, 0);
    s.toggle(win, false); assert.equal(win.monitor, 0);
    s.setMonitors([{index: 0, key: 'HDMI-1'}, {index: 1, key: 'eDP-1'}]); s.flush();
    assert.equal(oldStack.index, 0, 'connector identity survives monitor renumbering');
    s.lifecycle.destroy();
}
// Closing a fullscreen window returns the monitor to its origin, and no
// deferred callbacks query the unmanaged window.
{
    const s = setup(true); const win = s.makeWindow(0); s.enable(); s.toggle(win, true);
    const origin = s.lifecycle.windows.get(win).fullscreen.origin;
    s.windows.splice(s.windows.indexOf(win), 1); win.emit('unmanaged'); win.destroyed = true; s.flush();
    assert.equal(s.active(), origin.workspace); assert.equal(win.handlers.size, 0); s.lifecycle.destroy();
}
// External workspace removal must not leave a connected monitor with an empty
// render projection or an undefined fit-all geometry target.
{
    const s = setup(false); s.enable();
    const order = s.lifecycle.orderForMonitor(1);
    order.slots[0].workspace = s.workspaces[1];
    s.manager.remove_workspace(s.workspaces[1]); s.flush();
    assert.equal(order.slots.length, 1);
    assert.equal(order.slots[0].workspace, s.active());
    s.lifecycle.destroy();
}
// Fullscreen notifications and workspace changes are separate signals. A
// client/compositor can restore placement in the same main-loop turn as exit;
// that must not look like a user moving an application that is still fullscreen.
for (const dynamic of [false, true]) for (const workspaceFirst of [false, true]) for (const unclaimed of [false, true]) {
    const s = setup(dynamic), win = s.makeWindow(0), other = s.makeWindow(1);
    s.enable();
    const origin = s.lifecycle.orderForMonitor(0).slots[0];
    s.lifecycle.addWorkspace(0, false); s.lifecycle.addWorkspace(0, false);
    s.toggle(win, true);
    const temporary = s.lifecycle.windows.get(win).fullscreen.slot;
    // Rotate physical backing while fullscreen on the other monitor, then
    // restore the application's normal placement before deferred processing.
    s.choose(1); s.lifecycle.addWorkspace(1); s.flush();
    const otherSlot = s.lifecycle.orderForMonitor(1).slots.find(slot => slot.workspace === s.active());
    const expectedSlotCount = s.lifecycle.orderForMonitor(0).slots.length - 1;
    const restoredPlacement = unclaimed ? s.manager.append_new_workspace() :
        s.lifecycle.orderForMonitor(0).slots.find(slot => slot !== temporary && slot !== origin).workspace;
    win.fullscreen = false;
    if (!workspaceFirst) win.emit('notify::fullscreen');
    win.change_workspace(restoredPlacement);
    if (workspaceFirst) win.emit('notify::fullscreen');
    s.flush();
    assert.equal(win.workspace, origin.workspace, 'exit returns to the stable original slot despite coalesced placement signals');
    assert.equal(s.active(), origin.workspace, 'owned fullscreen exit returns its display to the original logical slot');
    assert.equal(otherSlot.workspace, s.active(), 'other display retains its selected logical slot');
    assert.equal(temporary.retired, true);
    assert.equal(s.lifecycle.orderForMonitor(0).slots.length, expectedSlotCount, 'intermediate unclaimed placement does not create a permanent logical slot');
    assert.equal(s.lifecycle.windows.get(win).fullscreen, null);
    s.lifecycle.destroy();
}
// An intentional move while the window is still fullscreen remains authoritative
// even when unfullscreen follows before the queued workspace callback runs.
{
    const s = setup(false), win = s.makeWindow(0); s.enable();
    const userSlot = s.lifecycle.addWorkspace(0, false);
    s.toggle(win, true);
    win.change_workspace(userSlot.workspace);
    win.fullscreen = false; win.emit('notify::fullscreen'); s.flush();
    assert.equal(win.workspace, userSlot.workspace);
    s.lifecycle.destroy();
}
// The active-workspace notification may reach extension callbacks after the
// caller's activation scope. Monitor ownership must survive that boundary,
// including when fullscreen originates on a display away from the pointer.
for (const dynamic of [false, true]) {
    const s = setup(dynamic, true), win = s.makeWindow(0), sameDisplay = s.makeWindow(0), other = s.makeWindow(1);
    s.enable(); s.lifecycle.addWorkspace(0, false); s.flush();
    const origin = s.lifecycle.orderForMonitor(0).slots[0];
    s.choose(1); s.toggle(win, true);
    const state = s.lifecycle.windows.get(win);
    assert(state.fullscreen, 'deferred activation retains fullscreen ownership');
    assert.equal(sameDisplay.workspace, origin.workspace, 'fullscreen does not compensate its own display');
    assert.equal(other.workspace, s.active(), 'inactive display remains on its selected logical slot');
    s.toggle(win, false);
    assert.equal(win.workspace, origin.workspace, 'deferred fullscreen exit returns to original slot');
    assert.equal(s.active(), origin.workspace);
    assert.equal(other.workspace, s.active());
    s.lifecycle.destroy();
}
// A superseding external activation must consume/cancel the old target token;
// it must not capture an unrelated later switch to the same physical workspace.
{
    const s = setup(false, true), win = s.makeWindow(0), other = s.makeWindow(1);
    s.enable();
    const requested = s.lifecycle.addWorkspace(0, false);
    const external = s.lifecycle.addWorkspace(1, false);
    // Use another backing identity for the external switch.
    external.workspace = s.workspaces.find(ws => ws !== requested.workspace && ws !== s.active());
    s.choose(1); s.lifecycle.activate(s.lifecycle.stackForMonitor(0), requested);
    external.workspace.activate(); s.flush();
    assert.equal(s.lifecycle.pendingActivation, null);
    assert.equal(s.active(), external.workspace);
    requested.workspace.activate(); s.flush();
    assert.equal(s.lifecycle.pendingActivation, null);
    s.lifecycle.destroy();
}
// Native shortcuts retain Shell's animation decision while using the same
// destination ownership as Orchard's nonanimated activation path.
for (const deferred of [false, true]) {
    const s = setup(false, deferred), win = s.makeWindow(0), other = s.makeWindow(1);
    s.enable();
    const slot = s.lifecycle.addWorkspace(0, false);
    s.choose(1);
    s.lifecycle.activate(s.lifecycle.stackForMonitor(0), slot, {animate: true});
    s.flush();
    assert.equal(s.animationDecisions.at(-1), true, 'native shortcut keeps the native animation gate');
    assert.equal(s.active(), slot.workspace);
    assert.equal(other.workspace, s.active(), 'owned display survives deferred notification');
    assert.notEqual(win.workspace, s.active());
    assert.equal(s.lifecycle.pendingActivation, null);
    assert.equal(s.lifecycle.forcedMonitor, null);
    s.lifecycle.destroy();
}
console.log('PASS: independent initialization/expansion, fixed/dynamic retention, fullscreen return and coalesced exit, deferred activation ownership, native animation gating, manual moves, hotplug and cleanup');
