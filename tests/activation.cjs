// Real Shell activateWindow(), with modelled native activation/compensation.
// This checks signal ordering and ownership, not compositor rendering.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const nativeMain = process.env.ORCHARD_MAIN_SOURCE
    ? fs.readFileSync(process.env.ORCHARD_MAIN_SOURCE, 'utf8')
    : execFileSync('/usr/bin/gresource', ['extract', '/usr/lib/gnome-shell/libshell-51.so',
        '/org/gnome/shell/ui/main.js'], {encoding: 'utf8'});
const start = nativeMain.indexOf('export function activateWindow(');
assert(start >= 0);
const end = nativeMain.indexOf('\n}', start);
const activateSource = nativeMain.slice(start, end + 2).replace('export ', '');

function setup({targetMonitor = 1, enabled = true, hooks = true} = {}) {
    let active, focused = null, switcher, switches = 0, cancelled = 0, selection = null;
    const windows = [], animationMonitors = [];
    const otherMonitor = 1 - targetMonitor;
    const pointer = [otherMonitor * 100 + 10, 10];
    function select(workspace) {
        if (active === workspace) return;
        assert(++switches < 10, 'activation must not recursively chase a moved window');
        active = workspace;
        switcher.onGlobalWorkspaceChanged();
        animationMonitors.push(resolver.resolve());
    }
    // C -> C calls do not invoke GJS prototype overrides. Keep the model's
    // native implementation separate so app activation really tests that gap.
    function nativeFocus(window, workspace = window.workspace) {
        if (window.reject) return;
        if (window.fail) throw new Error('native activation failed');
        select(workspace);
        if (window.workspace !== active && !window.sticky)
            return nativeFocus(window);
        focused = window;
    }
    function appTarget(window) {
        const transients = [];
        window.foreach_transient(w => { if (w.workspace === window.workspace) transients.push(w); return true; });
        const top = transients.sort((a, b) => b.stacking - a.stacking)
            .find(w => [1, 2].includes(w.type));
        return top && top.userTime > window.userTime ? top : window;
    }
    class Workspace {
        index() { return workspaces.indexOf(this); }
        activate() { select(this); }
        activate_with_focus(window, time) {
            if (window) nativeFocus(window, this);
            else select(this);
            return time;
        }
    }
    const workspaces = Array.from({length: 4}, () => new Workspace());
    active = workspaces[0];
    class Window {
        constructor(monitor, workspace = active) {
            this.monitor = monitor; this.workspace = workspace; this.sticky = false;
            this.parent = null; this.userTime = 1; this.stacking = 1; this.type = 1;
            windows.push(this);
        }
        get_monitor() { return this.monitor; }
        get_workspace() { return this.workspace; }
        get_window_type() { return this.type; }
        get_transient_for() { return this.parent; }
        get_user_time() { return this.userTime; }
        foreach_transient(callback) {
            for (const child of windows.filter(w => w.parent === this)) {
                if (callback(child)) child.foreach_transient(callback);
            }
        }
        is_on_all_workspaces() { return this.sticky; }
        change_workspace_by_index(index) {
            this.workspace = workspaces[index];
            this.foreach_transient(child => { child.workspace = workspaces[index]; return true; });
            // Mutter moves ancestors without recursively moving their other
            // children. A child move must not implicitly relocate siblings.
            for (let parent = this.parent; parent; parent = parent.parent)
                parent.workspace = workspaces[index];
        }
        activate(time) { nativeFocus(this); return time; }
        activate_with_workspace(time, workspace) { nativeFocus(this, workspace); return time; }
    }
    class App {
        constructor(orderedWindows) { this.windows = orderedWindows; }
        get_windows() { return this.windows; }
        activate_window(window, time) {
            window ??= this.windows[0];
            if (this.windows.includes(window)) nativeFocus(appTarget(window));
            return time;
        }
        activate_full(_workspace, time) {
            const window = this.windows[0];
            if (window) nativeFocus(appTarget(window));
            return time;
        }
        activate() {
            const window = this.windows[0];
            if (window) nativeFocus(appTarget(window));
            return 42;
        }
    }
    const manager = {get_n_workspaces: () => workspaces.length,
        get_active_workspace: () => active, get_active_workspace_index: () => active.index(),
        get_workspace_by_index: i => workspaces[i]};
    const ctx = vm.createContext({Meta: {Window, Workspace, WindowType: {NORMAL: 1, DIALOG: 2}},
        Shell: {App}, Main: {layoutManager: {monitors: [0, 1].map(index =>
            ({index, x: index * 100, y: 0, width: 100, height: 100}))}},
        global: {workspace_manager: manager, get_pointer: () => pointer,
            display: {sort_windows_by_stacking: list => [...list].sort((a, b) => a.stacking - b.stacking),
                xserver_time_is_before: (a, b) => a < b},
            get_window_actors: () => windows.map(w => ({get_meta_window: () => w})),
            get_current_time: () => 123}, overview: {hide() {}}, panel: {closeCalendar() {}}});
    for (const file of ['methodOverrides', 'monitor', 'activation', 'switcher'])
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../shell', file + '.js'), 'utf8')
            .replace(/^import .*;\s*$/gm, '').replace(/^export class /gm, 'class '), ctx);
    vm.runInContext(activateSource + '\nthis.api = {MonitorResolver, WindowActivation, WorkspaceSwitcher, activateWindow};', ctx);
    const config = {conditionallyEnableAutomaticSwitching() {}, automaticSwitchingIsEnabled: () => enabled};
    const resolver = new ctx.api.MonitorResolver();
    const animation = {get selectedMonitor() { return selection; }, cancel() { cancelled++; selection = null; }};
    switcher = new ctx.api.WorkspaceSwitcher(config, resolver, animation);
    const target = new Window(targetMonitor, workspaces[1]);
    const other = new Window(otherMonitor);
    const hiddenOther = new Window(otherMonitor, workspaces[2]);
    const activation = new ctx.api.WindowActivation(config, resolver);
    if (hooks) activation.enable();
    return {target, other, hiddenOther, activation, resolver, workspaces, Window, Workspace, App,
        main: ctx.api.activateWindow, active: () => active, focused: () => focused,
        switches: () => switches, cancelled: () => cancelled, animationMonitors,
        pointer, select, setSelection(value) { selection = value; }};
}

const routes = {
    main: s => s.main(s.target, 123),
    window: s => s.target.activate(123),
    windowWithWorkspace: s => s.target.activate_with_workspace(123, s.target.workspace),
    workspaceWithFocus: s => s.target.workspace.activate_with_focus(s.target, 123),
    appWindow: s => new s.App([s.other, s.target]).activate_window(s.target, 123),
    appDefaultWindow: s => new s.App([s.target, s.other]).activate_window(null, 123),
    launcher: s => new s.App([s.target, s.other]).activate(),
    launcherFull: s => new s.App([s.target, s.other]).activate_full(-1, 123),
};
for (const targetMonitor of [0, 1]) {
    for (const [name, route] of Object.entries(routes)) {
        const s = setup({targetMonitor});
        const originalTarget = s.target.workspace;
        s.setSelection(1 - targetMonitor); // An older animation must not win.
        route(s);
        assert.equal(s.focused(), s.target, name);
        assert.equal(s.active(), originalTarget, name);
        assert.equal(s.target.workspace, originalTarget, name);
        assert.equal(s.other.workspace, s.active(), name + ': other display stays visible');
        assert.notEqual(s.hiddenOther.workspace, s.active(), name + ': hidden windows stay hidden');
        assert.equal(s.switches(), 1, name);
        assert.equal(s.cancelled(), 1, name);
        assert.deepEqual(s.animationMonitors, [targetMonitor], name + ': animation uses destination display');
        assert.equal(s.resolver.activationMonitor, null);
        assert.equal(s.resolver.resolve(), 1 - targetMonitor, 'pointer behavior resumes after activation');
        s.activation.destroy();
    }
}
// Negative control establishes that the model actually exposes the old loop.
{
    const s = setup({hooks: false});
    assert.throws(() => s.main(s.target, 123), /recursively chase/);
}
// All-displays mode does not compensate or override pointer selection.
{
    const s = setup({enabled: false});
    routes.main(s);
    assert.equal(s.focused(), s.target);
    assert.equal(s.other.workspace, s.workspaces[0]);
    assert.equal(s.cancelled(), 0);
    assert.deepEqual(s.animationMonitors, [0]);
    s.activation.destroy();
}
// No-op, rejected and throwing requests must neither leak ownership nor stop
// an existing animation when no workspace change happened.
for (const mode of ['visible', 'reject', 'fail', 'emptyApp', 'foreignWindow', 'nullFocus', 'invalidMonitor']) {
    const s = setup();
    if (mode === 'visible') s.target.workspace = s.active();
    if (mode === 'reject') s.target.reject = true;
    if (mode === 'fail') s.target.fail = true;
    if (mode === 'invalidMonitor') { s.target.monitor = 9; s.target.reject = true; }
    const invoke = () => {
        if (mode === 'emptyApp') return new s.App([]).activate();
        if (mode === 'foreignWindow') return new s.App([s.other]).activate_window(s.target, 123);
        if (mode === 'nullFocus') return s.active().activate_with_focus(null, 123);
        return routes.appWindow(s);
    };
    if (mode === 'fail') assert.throws(invoke, /native activation failed/);
    else invoke();
    assert.equal(s.cancelled(), 0, mode);
    assert.equal(s.resolver.activationMonitor, null, mode);
    s.activation.destroy();
}
// Nested ownership and disable during either call cannot retain a context.
for (const nestedDisable of [false, true]) {
    const s = setup();
    s.activation._run(s.target, () => {
        assert.equal(s.resolver.resolve(), 1);
        s.activation._run(s.other, () => {
            assert.equal(s.resolver.resolve(), 0);
            if (nestedDisable) s.activation.destroy();
        });
        if (!nestedDisable) {
            assert.equal(s.resolver.resolve(), 1);
            s.activation.destroy();
        }
    });
    assert.equal(s.resolver.activationMonitor, null);
    assert.equal(s.activation._configuration, null);
    assert.equal(s.activation._resolver, null);
    assert.equal(s.activation._overrides, null);
}
// Cleanup must preserve native return values and detach retained wrappers.
{
    const s = setup();
    const wrapped = s.App.prototype.activate;
    assert.equal(new s.App([]).activate(), 42);
    s.activation.destroy();
    assert.notEqual(s.App.prototype.activate, wrapped);
    assert.equal(wrapped.call(new s.App([])), 42);
}
console.log('PASS: Main, window, workspace-focus, app-switcher and launcher activation in both display directions; single-switch compensation, animation ownership, no-op/failure/nesting/disable cleanup');

for (const targetMonitor of [0, 1]) {
    for (const route of ['appWindow', 'appDefaultWindow', 'launcher', 'launcherFull', 'main', 'window', 'workspaceWithFocus']) {
        const s = setup({targetMonitor});
        const parent = s.target;
        const child = new s.Window(1 - targetMonitor, parent.workspace);
        child.parent = parent; child.userTime = 2; child.stacking = 2;
        // A sibling must be protected too: moving it would move the shared
        // ancestor and target. Only this family, not the whole app, is exempt.
        const sibling = new s.Window(targetMonitor, parent.workspace); sibling.parent = parent;
        const untouched = new s.Window(targetMonitor, s.workspaces[0]);
        const unrelatedAppWindow = new s.Window(targetMonitor, s.workspaces[3]);
        if (route.startsWith('app') || route.startsWith('launcher')) {
            const app = new s.App([parent, unrelatedAppWindow]);
            if (route === 'appWindow') app.activate_window(parent, 123);
            if (route === 'appDefaultWindow') app.activate_window(null, 123);
            if (route === 'launcher') app.activate();
            if (route === 'launcherFull') app.activate_full(-1, 123);
        } else {
            s.target = child; routes[route](s);
        }
        assert.equal(s.focused(), child, route);
        assert.equal(s.switches(), 1, route);
        assert.equal(s.active(), parent.workspace, route);
        assert.equal(child.workspace, parent.workspace, route);
        assert.equal(sibling.workspace, parent.workspace, route);
        assert.equal(untouched.workspace, s.active(), route + ': unrelated visible window preserved');
        assert.notEqual(s.hiddenOther.workspace, s.active(), route + ': hidden window preserved');
        assert.notEqual(unrelatedAppWindow.workspace, s.active(), route);
        assert.deepEqual(s.animationMonitors, [child.monitor], route + ': effective native target owns animation');
        assert.equal(s.resolver.activation, null);
        s.other.activate(123); // A subsequent ordinary activation has no old family context.
        assert.equal(s.focused(), s.other);
        assert.equal(parent.workspace, s.active(), 'subsequent compensation must not shift relatives twice');
        assert.equal(sibling.workspace, parent.workspace);
        assert.equal(s.resolver.activation, null);
        s.activation.destroy();
    }
}
// Native app selection is not simply the transient with the newest time:
// Shell chooses the topmost eligible same-workspace transient first.
for (const mode of ['older', 'otherWorkspace', 'utility', 'topmostOlder']) {
    const s = setup();
    const child = new s.Window(0, s.target.workspace); child.parent = s.target; child.userTime = 2;
    if (mode === 'older') child.userTime = 0;
    if (mode === 'otherWorkspace') child.workspace = s.workspaces[2];
    if (mode === 'utility') child.type = 3;
    if (mode === 'topmostOlder') {
        const top = new s.Window(0, s.target.workspace); top.parent = s.target; top.userTime = 0; top.stacking = 3;
    }
    routes.appWindow(s);
    assert.equal(s.focused(), s.target, mode);
    assert.deepEqual(s.animationMonitors, [s.target.monitor], mode);
    s.activation.destroy();
}
console.log('PASS: effective native transient selection, cross-display ancestor/descendant workspace coupling, family protection, unrelated visible/hidden windows and subsequent activation');
