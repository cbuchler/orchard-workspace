// Installed Shell keybinding/filter/action methods with modelled windows and
// signals. Native callbacks are bound before Orchard installs its filter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const native = process.env.ORCHARD_WM_SOURCE
    ? fs.readFileSync(process.env.ORCHARD_WM_SOURCE, 'utf8')
    : execFileSync('/usr/bin/gresource', ['extract', '/usr/lib/gnome-shell/libshell-51.so',
        '/org/gnome/shell/ui/windowManager.js'], {encoding: 'utf8'});

function setup({indices = [0, 3], activeIndex = indices[0], monitor = 0, enabled = true,
    primaryOnly = false, vertical = false, rtl = false, hooks = true} = {}) {
    const signals = new Map(); let nextSignal = 1, focus, switcher, switches = 0, inserts = 0;
    let active, selected = null, primary = primaryOnly, activeOnly = enabled;
    const windows = [], decisions = [], popups = [];
    const motion = {LEFT: 1, RIGHT: 2, UP: 3, DOWN: 4};
    const display = {get focus_window() { return focus; }, clear_mouse_mode() {},
        sort_windows_by_stacking: list => list, xserver_time_is_before: (a, b) => a < b};
    class Workspace {
        index() { return workspaces.indexOf(this); }
        get active() { return this === active; }
        get_neighbor(direction) {
            let step = [motion.UP, motion.LEFT].includes(direction) ? -1 : 1;
            if (!vertical && rtl) step *= -1;
            return workspaces[this.index() + step] ?? this;
        }
        activate() {
            if (this === active) return;
            active = this; switches++;
            switcher.onGlobalWorkspaceChanged();
            decisions.push(Main.wm._shouldAnimate());
        }
        activate_with_focus(window) { this.activate(); focus = window; }
    }
    const workspaces = Array.from({length: 5}, () => new Workspace());
    active = workspaces[activeIndex];
    class Window {
        constructor(displayIndex, workspace) { this.monitor = displayIndex; this.workspace = workspace; windows.push(this); }
        get_monitor() { return this.monitor; }
        get_workspace() { return this.workspace; }
        get_window_type() { return 1; }
        get_transient_for() { return null; }
        foreach_transient() {}
        is_on_all_workspaces() { return !!this.sticky; }
        is_always_on_all_workspaces() { return !!this.alwaysSticky; }
        change_workspace(workspace) { this.workspace = workspace; this.sticky = false; }
        change_workspace_by_index(index) { this.change_workspace(workspaces[index]); }
        activate() { this.workspace.activate(); focus = this; }
        activate_with_workspace(_time, workspace) { workspace.activate(); focus = this; }
    }
    class App { get_windows() { return []; } activate() {} activate_full() {} activate_window() {} }
    const target = new Window(monitor, active), hidden = new Window(monitor, workspaces[indices.at(-1)]);
    const other = new Window(1 - monitor, active), otherHidden = new Window(1 - monitor, workspaces[2]);
    focus = target;
    const manager = {layout_rows: vertical ? -1 : 1, layout_columns: vertical ? 1 : -1,
        get n_workspaces() { return workspaces.length; }, get_n_workspaces: () => workspaces.length,
        get_active_workspace: () => active, get_active_workspace_index: () => active.index(),
        get_workspace_by_index: i => workspaces[i]};
    display.get_workspace_manager = () => manager;
    const shellwm = {connect(_name, callback) { const id = nextSignal++; signals.set(id, callback); return id; },
        disconnect(id) { assert(signals.delete(id)); }};
    const global = {display, window_manager: shellwm, workspace_manager: manager,
        get_current_time: () => 123, get_pointer: () => [monitor * 100 + 10, 10],
        get_window_actors: () => windows.map(window => ({get_meta_window: () => window})),
        backend: {get_monitor_manager: () => ({get_logical_monitors: () => [0, 1].map(index =>
            ({get_number: () => index, get_monitors: () => [{get_connector: () => 'display-' + index}]}))})}};
    const Main = {actionMode: 1, sessionMode: {hasWorkspaces: true}, overview: {visible: false},
        layoutManager: {primaryIndex: 0, monitors: [0, 1].map(index =>
            ({index, x: index * 100, y: 0, width: 100, height: 100}))}, wm: {
            _workspaceAnimation: {gestureActive: false}, _allowedKeybindings: {},
            blockWorkspaceUpdates() {}, unblockWorkspaceUpdates() {},
            insertWorkspace() { inserts++; workspaces.push(new Workspace()); }, _isWorkspacePrepended: false,
        }};
    const Shell = {App, ActionMode: {NONE: 0, NORMAL: 1, OVERVIEW: 2, POPUP: 4}};
    const ctx = vm.createContext({Main, Shell, global, Meta: {Window, Workspace, MotionDirection: motion,
        WindowType: {NORMAL: 1, DIALOG: 2}, prefs_get_workspaces_only_on_primary: () => primary},
        Clutter: {get_default_text_direction: () => rtl ? 1 : 0, TextDirection: {RTL: 1}},
        WorkspaceSwitcherPopup: {WorkspaceSwitcherPopup: class {
            connect() {} display(index) { popups.push(index); }
        }}});
    for (const name of ['_showWorkspaceSwitcher', '_filterKeybinding', '_shouldAnimate', 'actionMoveWorkspace', 'actionMoveWindow']) {
        const start = native.indexOf('    ' + name + '('), end = native.indexOf('\n    }\n', start);
        assert(start >= 0 && end > start, name);
        Main.wm[name] = vm.runInContext('({' + native.slice(start, end + 6) + '}).' + name, ctx);
    }
    const boundNative = Main.wm._showWorkspaceSwitcher.bind(Main.wm);
    shellwm.connect('filter-keybinding', Main.wm._filterKeybinding.bind(Main.wm));
    for (const file of ['methodOverrides', 'monitor', 'activation', 'lifecycle', 'switcher', 'shortcuts'])
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../shell', file + '.js'), 'utf8')
            .replace(/^import .*;\s*$/gm, '').replace(/^export class /gm, 'class '), ctx);
    vm.runInContext('this.api = {ConfigurationService, MonitorResolver, LogicalWorkspaceLifecycle, WorkspaceSwitcher, NativeWorkspaceShortcuts, WindowActivation, LogicalWorkspaceOrder};', ctx);
    const config = new ctx.api.ConfigurationService({get_boolean: () => activeOnly});
    config.conditionallyEnableAutomaticSwitching();
    const resolver = new ctx.api.MonitorResolver();
    const lifecycle = new ctx.api.LogicalWorkspaceLifecycle(config, resolver);
    lifecycle.initialize();
    lifecycle.stackForMonitor(monitor).order = new ctx.api.LogicalWorkspaceOrder(indices.map(i => workspaces[i]));
    const overview = {syncActiveWorkspace() {}, moveWithoutPreviewAnimation(_window, _index, move) { move(); },
        shiftWorkspaceOrder(chosen, shift) {
            for (const stack of lifecycle.stacks.values()) if (stack.index !== chosen) stack.order.shift(shift, workspaces);
        }};
    const animation = {get selectedMonitor() { return selected; }, cancel() { selected = null; }};
    lifecycle.animation = animation;
    switcher = new ctx.api.WorkspaceSwitcher(config, resolver, animation, overview, lifecycle);
    const activation = new ctx.api.WindowActivation(config, resolver); activation.enable();
    const shortcuts = new ctx.api.NativeWorkspaceShortcuts(switcher);
    if (hooks) shortcuts.enable();
    return {shortcuts, lifecycle, activation, Main, target, hidden, other, otherHidden, workspaces,
        decisions, popups, signals, Window, resolver,
        active: () => active, switches: () => switches, inserts: () => inserts,
        chooseAnimation(index) { selected = index; }, focus(window) { focus = window; },
        setEnabled(value) { activeOnly = value; }, setPrimaryOnly(value) { primary = value; },
        order: () => Array.from(lifecycle.orderForMonitor(monitor).workspaces, ws => ws.index()),
        dispatch(name) {
            Main.wm._allowedKeybindings[name] = 3;
            const binding = {get_name: () => name, is_builtin: () => true};
            for (const callback of signals.values()) if (callback(shellwm, binding)) return;
            boundNative(display, focus, null, binding);
        },
        destroy() { shortcuts.destroy(); activation.destroy(); },
    };
}

for (const monitor of [0, 1]) {
    for (const indices of [[0, 3], [3, 0], [4, 1, 3]]) {
        for (const [vertical, rtl, next, previous] of [[false, false, 'right', 'left'], [false, true, 'left', 'right'], [true, false, 'down', 'up']]) {
            const s = setup({monitor, indices, vertical, rtl});
            s.dispatch('switch-to-workspace-' + next);
            assert.equal(s.active(), s.workspaces[indices[1]]);
            assert.deepEqual(s.order(), indices, 'native switching must not adopt a physical neighbor');
            assert.equal(s.other.workspace, s.active(), 'inactive display retains visible window');
            assert.notEqual(s.otherHidden.workspace, s.active(), 'inactive hidden window stays hidden');
            s.dispatch('switch-to-workspace-' + previous);
            assert.equal(s.active(), s.workspaces[indices[0]]);
            s.dispatch('switch-to-workspace-' + previous);
            assert.equal(s.switches(), 2, 'first boundary is a no-op');
            s.dispatch('switch-to-workspace-last');
            assert.equal(s.active(), s.workspaces[indices.at(-1)]);
            const changes = s.switches();
            s.dispatch('switch-to-workspace-' + next);
            assert.equal(s.switches(), changes, 'last boundary is a no-op');
            assert(s.decisions.every(Boolean), 'native switches preserve native animation gating');
            assert.equal(s.inserts(), 0);
            s.destroy();
        }
    }
}
for (const mode of ['number', 'overview', 'animationLock', 'move', 'moveNumber', 'moveBoundary', 'sticky', 'nullWindow', 'wrongAxis']) {
    const s = setup({indices: [0, 3]});
    if (mode === 'overview') s.Main.overview.visible = true, s.Main.actionMode = 2;
    if (mode === 'number' || mode === 'overview') {
        s.dispatch('switch-to-workspace-2'); assert.equal(s.active(), s.workspaces[3]);
        s.dispatch('switch-to-workspace-4'); assert.equal(s.switches(), 1, 'invalid logical ordinal is a no-op');
    } else if (mode === 'animationLock') {
        s.chooseAnimation(1); s.dispatch('switch-to-workspace-right');
        assert.equal(s.active(), s.workspaces[2], 'locked display order wins over pointer');
    } else if (mode === 'move' || mode === 'moveNumber') {
        s.focus(s.other); // Pointer remains on display 0; focused window is on display 1.
        const untouchedSlot = s.lifecycle.orderForMonitor(0).slots[0];
        s.dispatch(mode === 'move' ? 'move-to-workspace-right' : 'move-to-workspace-2');
        assert.equal(s.other.workspace, s.active());
        assert.equal(s.active(), s.workspaces[2]);
        assert.equal(s.target.workspace, untouchedSlot.workspace);
        assert.equal(s.target.workspace, s.active(), 'unrelated display remains visible');
    } else if (mode === 'moveBoundary') {
        s.dispatch('move-to-workspace-left'); assert.equal(s.switches(), 0); assert.equal(s.inserts(), 0);
    } else if (mode === 'sticky') {
        s.target.alwaysSticky = true; s.dispatch('move-to-workspace-right'); assert.equal(s.switches(), 0);
    } else if (mode === 'nullWindow') {
        s.focus(null); s.dispatch('move-to-workspace-right'); assert.equal(s.switches(), 0);
    } else if (mode === 'wrongAxis') {
        s.dispatch('switch-to-workspace-down'); assert.equal(s.switches(), 0);
    }
    s.destroy();
}
for (const mode of ['disabled', 'primaryOnly', 'afterDisable']) {
    const s = setup();
    if (mode === 'disabled') s.setEnabled(false);
    if (mode === 'primaryOnly') s.setPrimaryOnly(true);
    if (mode === 'afterDisable') s.shortcuts.destroy();
    s.dispatch('switch-to-workspace-right');
    assert.equal(s.active(), s.workspaces[1], 'native global callback is restored/preserved');
    assert.equal(s.popups[0], 1);
    s.destroy();
}
{
    const s = setup(); s.Main.actionMode = 4;
    s.dispatch('switch-to-workspace-right'); assert.equal(s.switches(), 0, 'Shell mode filter still blocks'); s.destroy();
}
{
    const s = setup({hooks: false});
    s.dispatch('switch-to-workspace-right');
    assert.deepEqual(s.order(), [0, 3, 1], 'negative control reproduces the unclaimed physical-neighbor bug');
    s.destroy();
}
console.log('PASS: prebound native callbacks, sparse/rotated orders, both displays, horizontal/vertical/RTL, boundaries, logical numbers/last, moves, animation ownership, overview, modes and filter cleanup');
