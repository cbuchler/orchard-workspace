const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let source = require('./runtime-source.cjs')();
source += '\nthis.OverviewWorkspaceIsolation = OverviewWorkspaceIsolation;';
class Signals {
    constructor() { this.ids = new Map(); this.owners = new Map(); this.next = 1; }
    connect(name, callback) { const id = this.next++; this.ids.set(id, {name, callback}); return id; }
    disconnect(id) { assert(this.ids.delete(id)); }
    connectObject(name, callback, owner) { this.owners.set(owner, {name, callback}); }
    disconnectObject(owner) { this.owners.delete(owner); }
    emit(name, ...args) {
        for (const entry of [...this.ids.values()]) if (entry.name === name) entry.callback(this, ...args);
        for (const entry of [...this.owners.values()]) if (entry.name === name) entry.callback(this, ...args);
    }
}
class Adjustment extends Signals {
    constructor(props = {}) { super(); Object.assign(this, {value: 0, lower: 0, upper: 5,
        page_size: 1, step_increment: 1, page_increment: 1}, props); }
    change(value) { this.value = value; this.emit('notify::value'); }
}
let selected = 0, active = 0, enabled = true;
const shared = new Adjustment();
const makeView = () => Object.assign(new Signals(), {
    _scrollAdjustment: shared, updates: 0, nativeScrolls: 0, starts: 0,
    _onScrollAdjustmentChanged() { this.updates++; },
    _scrollToActive() { this.nativeScrolls++; },
    _updateWorkspacesState() { this.updates++; }, queue_relayout() {},
    startTouchGesture() { this.starts++; },
    endTouchGesture() {},
});
const primary = makeView(), secondary = makeView();
const originalPrimaryScroll = primary._scrollToActive;
shared.connectObject('notify::value', primary._onScrollAdjustmentChanged.bind(primary), primary);
shared.connectObject('notify::value', secondary._onScrollAdjustmentChanged.bind(secondary), secondary);
const secondaryHost = Object.assign(new Signals(), {_workspacesView: secondary,
    startTouchGesture() { this._workspacesView.startTouchGesture(); },
    endTouchGesture() { this._workspacesView.endTouchGesture(); }});
const display = {_workspacesViews: [primary, secondaryHost], _scrollAdjustment: shared,
    _endTouchGesture() { for (const host of this._workspacesViews) host.endTouchGesture(); }};
const overview = new Signals(); overview.visible = true; overview.closing = false;
overview._overview = {controls: {_workspacesDisplay: display}};
const stage = new Signals();
const ctx = {Extension: class {}, Main: {overview}, St: {Adjustment},
    Clutter: {EVENT_PROPAGATE: 0}, global: {stage, workspace_manager: {get_active_workspace_index: () => active}},
    logError: error => { throw error; }};
vm.createContext(ctx); vm.runInContext(source, ctx);
const config = {conditionallyEnableAutomaticSwitching() {}, automaticSwitchingIsEnabled: () => enabled};
const isolation = new ctx.OverviewWorkspaceIsolation(config, {resolve: () => selected});
isolation.enable();
assert.equal(isolation.selectedMonitor, 0);
assert.equal(primary._scrollAdjustment, shared);
assert.notEqual(secondary._scrollAdjustment, shared);
const originalSecondaryValue = secondary._scrollAdjustment.value;
shared.change(0.5);
assert.equal(secondary._scrollAdjustment.value, originalSecondaryValue,
    'inactive display does not follow overview scroll');
secondary._scrollToActive();
assert.equal(secondary.nativeScrolls, 0, 'global workspace signals cannot animate the inactive view');
const window = {get_monitor: () => 1};
let duration = -1, createdClone;
const workspace = {_addWindowClone() {
    createdClone = {ease: options => { duration = options.duration; }};
    return createdClone;
}};
const originalAdd = workspace._addWindowClone;
secondary._workspaces = [workspace];
isolation.moveWithoutPreviewAnimation(window, 0, () => {
    workspace._addWindowClone(window).ease({scale_x: 1, scale_y: 1, duration: 250});
});
assert.equal(duration, 0, 'compensated inactive previews appear without an entrance animation');
assert.equal(workspace._addWindowClone, originalAdd, 'temporary preview hook is restored');
assert.equal(typeof createdClone.ease, 'function');
primary.startTouchGesture(); secondaryHost.startTouchGesture();
selected = 1; stage.emit('motion-event');
assert.equal(isolation.selectedMonitor, 0, 'gesture target remains locked');
active = 1; shared.value = 1;
isolation.syncActiveWorkspace();
assert.equal(secondary._scrollAdjustment.value, 1,
    'inactive view follows the compensated windows after activation');
display._endTouchGesture();
assert.equal(isolation.selectedMonitor, 1);
assert.notEqual(primary._scrollAdjustment, shared);
assert.equal(secondary._scrollAdjustment, shared);
enabled = false; isolation.refresh();
assert.equal(primary._scrollAdjustment, shared);
assert.equal(secondary._scrollAdjustment, shared);
assert.equal(shared.owners.size, 2, 'native view connections restored exactly once');
assert.equal(stage.ids.size, 0);
enabled = true;
overview.emit('showing');
assert.notEqual(primary._scrollAdjustment, shared, 'overview reopening reapplies isolation');
overview.emit('hiding');
assert.equal(primary._scrollAdjustment, shared, 'closing overview restores the native adjustment');
assert.equal(secondary._scrollAdjustment, shared);
assert.equal(shared.owners.size, 2);
isolation.destroy();
assert.equal(overview.ids.size, 0);
assert.equal(primary._scrollToActive, originalPrimaryScroll);
assert(!Object.hasOwn(secondaryHost, 'startTouchGesture') || secondaryHost.startTouchGesture.toString().includes('this._workspacesView'));
selected = 0;
isolation.enable();
assert(isolation._session);
secondary.emit('destroy');
assert.equal(isolation._session, null, 'destroying an overview view tears down its session');
assert.equal(stage.ids.size, 0, 'destroying a view removes the stage handler');
assert(!shared.owners.has(secondary), 'a destroyed view is never reconnected');
isolation.destroy();
// GNOME can rebuild its monitor views while the overview remains open.
// The old views must be unhooked before they are destroyed.
const replacementPrimary = makeView(), replacementSecondary = makeView();
secondary._scrollAdjustment = shared;
const replacementHost = Object.assign(new Signals(), {_workspacesView: replacementSecondary,
    startTouchGesture() {}, endTouchGesture() {}});
shared.connectObject('notify::value', replacementPrimary._onScrollAdjustmentChanged.bind(replacementPrimary), replacementPrimary);
shared.connectObject('notify::value', replacementSecondary._onScrollAdjustmentChanged.bind(replacementSecondary), replacementSecondary);
display._updateWorkspacesViews = function () {
    assert.equal(isolation._session, null, 'old views are unhooked before replacement');
    this._workspacesViews = [replacementPrimary, replacementHost];
};
isolation.enable();
display._updateWorkspacesViews();
assert(isolation._session, 'new views are isolated after replacement');
assert.notEqual(replacementSecondary._scrollAdjustment, shared);
isolation.destroy();
console.log('PASS: overview pinning, gesture selection, workspace synchronization, mode change, and cleanup');
