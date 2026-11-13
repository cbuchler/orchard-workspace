// Explicit logical navigation must animate on its requested monitor even when
// the pointer is elsewhere. This exercises the real resolver and lifecycle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup({pointer = 1, locked = null} = {}) {
    let active, lifecycle, resolver, cancellations = 0, during = null;
    const requests = [];
    const workspaces = Array.from({length: 4}, (_, i) => ({index: () => i, activate() {
        during?.();
        requests.push({workspace: i, monitor: resolver.resolve(), animate: lifecycle.forcedMonitor === null});
        active = this;
        lifecycle.takeActivationMonitor(this);
    }}));
    active = workspaces[0];
    const ctx = vm.createContext({Main: {layoutManager: {monitors: [0, 1].map(index =>
        ({index, x: index * 100, y: 0, width: 100, height: 100}))}},
        global: {get_pointer: () => [pointer * 100 + 10, 10], get_current_time: () => 123,
            get_window_actors: () => [], workspace_manager: {get_n_workspaces: () => workspaces.length,
                get_workspace_by_index: index => workspaces[index], get_active_workspace: () => active}},
        MethodOverrides: class { clear() {} },
    });
    for (const file of ['monitor', 'lifecycle']) {
        const source = fs.readFileSync(path.join(__dirname, '../shell', file + '.js'), 'utf8')
            .replace(/^import .*;\s*$/gm, '').replace(/^export class /gm, 'class ');
        vm.runInContext(source, ctx);
    }
    vm.runInContext('this.api = {MonitorResolver, LogicalWorkspaceLifecycle, LogicalWorkspaceOrder};', ctx);
    resolver = new ctx.api.MonitorResolver();
    lifecycle = new ctx.api.LogicalWorkspaceLifecycle({conditionallyEnableAutomaticSwitching() {},
        automaticSwitchingIsEnabled: () => true}, resolver);
    lifecycle.animation = {get selectedMonitor() { return locked; }, cancel() { cancellations++; locked = null; }};
    for (const index of [0, 1]) lifecycle.stacks.set('display-' + index, {index,
        order: new ctx.api.LogicalWorkspaceOrder([workspaces[0], workspaces[index ? 3 : 1]])});
    return {lifecycle, resolver, workspaces, requests, cancellations: () => cancellations,
        during(callback) { during = callback; }};
}

for (const [pointer, monitor] of [[1, 0], [0, 1]]) {
    for (const locked of [null, monitor, 1 - monitor]) {
        const s = setup({pointer, locked});
        const slot = s.lifecycle.addWorkspace(monitor);
        assert.equal(s.requests.at(-1).monitor, monitor, 'explicit add chooses its requested monitor');
        assert.equal(s.requests.at(-1).animate, true);
        assert.equal(s.cancellations(), locked !== null && locked !== monitor ? 1 : 0,
            'only a slide owned by a different monitor is cancelled');
        assert.equal(s.resolver.navigation, null);
        assert.equal(s.resolver.resolve(), pointer, 'the pointer resumes ownership after the call');
        const stack = s.lifecycle.stackForMonitor(monitor);
        s.lifecycle.activate(stack, stack.order.slots[0], {animate: true});
        assert.equal(s.requests.at(-1).monitor, monitor);
        assert.equal(s.resolver.navigation, null);
        assert(slot.workspace);
    }
}
{
    const s = setup();
    const previous = {monitor: 1, workspace: s.workspaces[3]};
    s.resolver.navigation = previous;
    s.during(() => assert.equal(s.resolver.resolve(), 0));
    s.lifecycle.activate(s.lifecycle.stackForMonitor(0), s.lifecycle.orderForMonitor(0).slots[1], {animate: true});
    assert.equal(s.resolver.navigation, previous, 'nested navigation restores the earlier owner atomically');
    s.resolver.activation = {monitor: 1};
    s.during(() => assert.equal(s.resolver.resolve(), 1, 'window activation has higher priority than navigation'));
    s.lifecycle.activate(s.lifecycle.stackForMonitor(0), s.lifecycle.orderForMonitor(0).slots[0], {animate: true});
    assert.equal(s.resolver.navigation, previous);
}
{
    const s = setup({locked: 1});
    s.during(() => { assert.equal(s.resolver.resolve(), 0); throw new Error('native activation failed'); });
    assert.throws(() => s.lifecycle.addWorkspace(0), /native activation failed/);
    assert.equal(s.resolver.navigation, null);
    assert.equal(s.lifecycle.pendingActivation, null);
    assert.equal(s.resolver.resolve(), 1, 'exception cannot retain the failed destination');
}
{
    const s = setup();
    s.resolver.navigation = {monitor: 1};
    s.during(() => s.lifecycle.destroy());
    s.lifecycle.addWorkspace(0);
    assert.equal(s.resolver.navigation, null, 'disable during activation cannot resurrect the earlier navigation scope');
}
{
    const s = setup();
    s.resolver.navigation = {monitor: 99};
    assert.equal(s.resolver.resolve(), 1, 'an absent navigation monitor falls back to pointer selection');
}
console.log('PASS: explicit navigation monitor ownership, cross-monitor cancellation, same-monitor continuity, window priority, nested/failed/disabled scope cleanup');
