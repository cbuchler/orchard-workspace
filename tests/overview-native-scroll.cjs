// Exercise the installed GNOME 51 overview scroll callback with mock views.
// This verifies signal routing; it is not a visual compositor test.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const native = process.env.ORCHARD_OVERVIEW_SOURCE
    ? fs.readFileSync(process.env.ORCHARD_OVERVIEW_SOURCE, 'utf8')
    : execFileSync('/usr/bin/gresource', ['extract', '/usr/lib/gnome-shell/libshell-51.so',
        '/org/gnome/shell/ui/workspacesView.js'], {encoding: 'utf8'});
const workspaceNative = process.env.ORCHARD_WORKSPACE_SOURCE
    ? fs.readFileSync(process.env.ORCHARD_WORKSPACE_SOURCE, 'utf8')
    : execFileSync('/usr/bin/gresource', ['extract', '/usr/lib/gnome-shell/libshell-51.so',
        '/org/gnome/shell/ui/workspace.js'], {encoding: 'utf8'});
const start = native.indexOf('    _onScrollAdjustmentChanged() {');
assert(start >= 0, 'GNOME overview scroll handler not found');
const end = native.indexOf('\n    }\n', start);
assert(end > start, 'GNOME overview scroll handler end not found');
const nativeMethod = native.slice(start, end + '\n    }'.length);
let extension = require('./runtime-source.cjs')();
extension += '\nthis.OverviewWorkspaceIsolation = OverviewWorkspaceIsolation;';
class Signals {
    constructor() { this.ids = new Map(); this.owners = new Map(); this.next = 1; }
    connect(name, callback) { const id = this.next++; this.ids.set(id, {name, callback}); return id; }
    disconnect(id) { assert(this.ids.delete(id)); }
    connectObject(name, callback, owner) { this.owners.set(owner, {name, callback}); }
    disconnectObject(owner) { this.owners.delete(owner); }
    emit(name) { for (const entry of [...this.owners.values()]) if (entry.name === name) entry.callback(); }
}
class Adjustment extends Signals {
    constructor(props = {}) { super(); Object.assign(this, {value: 0, lower: 0, upper: 3,
        page_size: 1, step_increment: 1, page_increment: 1}, props); }
    get_transition() { return null; }
    change(value) { this.value = value; this.emit('notify::value'); }
}
let active = 0, activationCount = 0;
const manager = {get_active_workspace_index: () => active};
const overview = new Signals(); overview.visible = true; overview.closing = false;
const stage = new Signals();
const ctx = vm.createContext({Extension: class {}, Main: {overview}, St: {Adjustment},
    Clutter: {EVENT_PROPAGATE: 0}, global: {stage, workspace_manager: manager, get_current_time: () => 0},
    logError: error => { throw error; }});
vm.runInContext(extension, ctx);
const onScroll = vm.runInContext(`({${nativeMethod}})._onScrollAdjustmentChanged`, ctx);
const shared = new Adjustment();
function view() {
    const result = Object.assign(new Signals(), {_scrollAdjustment: shared, _gestureActive: false, updates: 0,
        _workspaces: Array.from({length: 3}, (_, i) => ({metaWorkspace: {activate() { active = i; activationCount++; }}})),
        has_allocation: () => true, _scrollToActive() {}, _updateWorkspacesState() { this.updates++; },
        queue_relayout() {}, startTouchGesture() { this._gestureActive = true; },
        endTouchGesture() { this._gestureActive = false; }, _onScrollAdjustmentChanged: onScroll});
    shared.connectObject('notify::value', onScroll.bind(result), result);
    return result;
}
const primary = view(), secondary = view();
const host = Object.assign(new Signals(), {_workspacesView: secondary, startTouchGesture() { secondary.startTouchGesture(); },
    endTouchGesture() { secondary.endTouchGesture(); }});
const display = {_workspacesViews: [primary, host], _scrollAdjustment: shared,
    _endTouchGesture() { primary.endTouchGesture(); host.endTouchGesture(); }};
overview._overview = {controls: {_workspacesDisplay: display}};
const isolation = new ctx.OverviewWorkspaceIsolation({conditionallyEnableAutomaticSwitching() {},
    automaticSwitchingIsEnabled: () => true}, {resolve: () => 0});
isolation.enable();
primary.startTouchGesture(); host.startTouchGesture();
shared.change(0.6);
assert.equal(primary.updates, 1, 'selected view handles native overview scrolling');
assert.equal(secondary.updates, 0, 'inactive view does not handle shared scroll');
assert.equal(secondary._scrollAdjustment.value, 0);
assert.equal(activationCount, 0, 'gesture does not activate a workspace during drag');
// GNOME's real workspace callback animates every new window preview from
// scale 0. A compensation move must not replay that animation on the pinned
// display, while retaining the original callback and its cleanup afterward.
const addStart = workspaceNative.indexOf('    _doAddWindow(metaWin) {');
const addEnd = workspaceNative.indexOf('\n    }\n', addStart);
assert(addStart >= 0 && addEnd > addStart, 'GNOME workspace add handler not found');
const addMethod = workspaceNative.slice(addStart, addEnd + '\n    }'.length);
const nativeAdd = vm.runInContext(`({${addMethod}})._doAddWindow`, ctx);
let previewDuration = -1;
const metaWindow = {get_monitor: () => 1, get_compositor_private: () => ({}), connect: () => 1};
const workspace = {
    _skipTaskbarSignals: new Map(), _layoutFrozenId: 0,
    containsMetaWindow: () => false, _isMyWindow: () => true, _isOverviewWindow: () => true,
    _addWindowClone: () => ({set_pivot_point() {}, ease: params => { previewDuration = params.duration; }}),
    _doAddWindow: nativeAdd,
};
secondary._workspaces = [workspace];
const originalAdd = workspace._addWindowClone;
isolation.moveWithoutPreviewAnimation(metaWindow, 0, () => workspace._doAddWindow(metaWindow));
assert.equal(previewDuration, 0, 'native window-preview entrance is suppressed for compensation');
assert.equal(workspace._addWindowClone, originalAdd, 'native clone method is restored');
active = 1;
isolation.syncActiveWorkspace();
assert.equal(secondary._scrollAdjustment.value, 1, 'inactive view follows compensated windows at commit');
display._endTouchGesture();
isolation.destroy();
assert.equal(shared.owners.size, 2, 'native scroll connections are restored');
console.log('PASS: GNOME 51 overview scroll handler is isolated for the inactive display');
