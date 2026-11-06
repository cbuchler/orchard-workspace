const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let source = require('./runtime-source.cjs')();
source += '\nthis.WorkspaceSwitcher = WorkspaceSwitcher; this.ConfigurationService = ConfigurationService; this.MonitorResolver = MonitorResolver;';
let activeOnly = true;
let primaryOnly = false;
let current;
let workspaces = [];
const windows = [];
const motion = {LEFT: 1, RIGHT: 2, UP: 3, DOWN: 4};
function makeWorkspace() {
    const workspace = {
        index: () => workspaces.indexOf(workspace),
        get_neighbor: direction => {
            const next = workspace.index() + ([motion.LEFT, motion.UP].includes(direction) ? -1 : 1);
            return workspaces[next] ?? workspace;
        },
        activate: () => { current = workspace; },
    };
    return workspace;
}
function makeWindow(monitor, workspace, sticky = false) {
    const data = {monitor, workspace, sticky};
    const window = {get_monitor: () => data.monitor, get_workspace: () => data.workspace,
        get_window_type: () => 1, is_on_all_workspaces: () => data.sticky,
        change_workspace_by_index: index => { data.workspace = workspaces[index]; }};
    windows.push({data, window});
    return data;
}
workspaces = [makeWorkspace(), makeWorkspace(), makeWorkspace()];
current = workspaces[0];
const manager = {layout_rows: 1, get_n_workspaces: () => workspaces.length,
    get_active_workspace_index: () => workspaces.indexOf(current), get_workspace_by_index: index => workspaces[index]};
let pointer = [10, 10];
const ctx = {Extension: class {}, global: {workspace_manager: manager, get_pointer: () => pointer,
    get_window_actors: () => windows.map(({window}) => ({get_meta_window: () => window})),
    get_current_time: () => 123},
    Meta: {MotionDirection: motion, WindowType: {NORMAL: 1}, prefs_get_workspaces_only_on_primary: () => primaryOnly},
    Main: {layoutManager: {monitors: [{index: 0, x: 0, y: 0, width: 100, height: 100},
        {index: 1, x: 110, y: 0, width: 100, height: 100}]}}};
vm.createContext(ctx); vm.runInContext(source, ctx);
const config = new ctx.ConfigurationService({get_boolean: key => {
    assert.equal(key, 'active-monitor-only'); return activeOnly;
}});
config.conditionallyEnableAutomaticSwitching();
const resolver = new ctx.MonitorResolver();
assert.equal(resolver.resolve(), 0);
pointer = [150, 10]; assert.equal(resolver.resolve(), 1);
pointer = [108, 10]; assert.equal(resolver.resolve(), 1, 'gap selects nearest display');
const animation = {selectedMonitor: null};
const switcher = new ctx.WorkspaceSwitcher(config, resolver, animation);
const primary = makeWindow(0, workspaces[0]);
const secondary = makeWindow(1, workspaces[0]);
const pinned = makeWindow(0, workspaces[0], true);
// Switching on the secondary display preserves the primary window.
current = workspaces[1]; switcher.onGlobalWorkspaceChanged();
assert.equal(primary.workspace, current);
assert.equal(secondary.workspace, workspaces[0]);
assert.equal(pinned.workspace, workspaces[0]);
// The monitor is locked during the gesture even if the pointer moves.
animation.selectedMonitor = 1; pointer = [10, 10];
current = workspaces[2]; switcher.onGlobalWorkspaceChanged();
assert.equal(primary.workspace, current);
assert.equal(secondary.workspace, workspaces[0]);
animation.selectedMonitor = null;
// Dynamic pruning may renumber the same active workspace: do not move again.
workspaces.shift();
const before = primary.workspace;
switcher.onGlobalWorkspaceChanged();
assert.equal(primary.workspace, before);
// In all-displays mode neither gesture compensation nor the animation applies.
activeOnly = false;
current = workspaces[0]; switcher.onGlobalWorkspaceChanged();
assert.equal(primary.workspace, before);
const oldCurrent = current;
switcher.switchWorkspace(1);
assert.notEqual(current, oldCurrent, 'shortcut activates a global neighbor');
const end = current;
switcher.switchWorkspace(1);
assert.equal(current, end, 'global shortcut stops at the boundary');
// Active-display shortcut moves only the selected monitor and leaves pinned windows alone.
activeOnly = true; pointer = [150, 10];
const secondaryBefore = secondary.workspace;
const pinnedBefore = pinned.workspace;
switcher.switchWorkspace(1);
assert.notEqual(secondary.workspace, secondaryBefore);
assert.equal(pinned.workspace, pinnedBefore);
primaryOnly = true; config.conditionallyEnableAutomaticSwitching();
assert.equal(config.automaticSwitchingIsEnabled(), false);
console.log('PASS: pointer selection, gestures, dynamic renumbering, both modes, and shortcuts');

// During overview navigation the monitor selected at gesture start wins even
// if the pointer has since crossed displays. Refresh the pinned overview view
// only after windows have been compensated.
{
    windows.length = 0;
    workspaces = [makeWorkspace(), makeWorkspace()]; current = workspaces[0];
    primaryOnly = false; activeOnly = true; config.conditionallyEnableAutomaticSwitching();
    pointer = [10, 10];
    const p = makeWindow(0, workspaces[0]);
    const s = makeWindow(1, workspaces[0]);
    let syncs = 0;
    const overview = {selectedMonitor: 1, shiftWorkspaceOrder() {},
        moveWithoutPreviewAnimation(_window, _target, move) { return move(); }, syncActiveWorkspace() {
        syncs++;
        assert.equal(p.workspace, current, 'overview synchronizes after window compensation');
    }};
    const controller = new ctx.WorkspaceSwitcher(config, resolver, {selectedMonitor: null}, overview);
    current = workspaces[1]; controller.onGlobalWorkspaceChanged();
    assert.equal(p.workspace, current);
    assert.equal(s.workspace, workspaces[0]);
    assert.equal(syncs, 1);
}
console.log('PASS: overview selection stays locked through window compensation');
