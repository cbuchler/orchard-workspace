// Exercise the real ordinary-navigation methods and activate() ownership scope.
// This is a lifecycle model, not a live compositor/visual test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup({pointer = 0, locked = null} = {}) {
    let active, lifecycle, cancellations = 0;
    const requests = [];
    const workspaces = Array.from({length: 5}, (_, i) => ({
        index: () => i,
        activate() {
            active = this;
            requests.push({workspace: i, animate: lifecycle.forcedMonitor === null,
                monitor: lifecycle.takeActivationMonitor(this)});
        },
    }));
    active = workspaces[0];
    const manager = {get_n_workspaces: () => workspaces.length,
        get_workspace_by_index: index => workspaces[index], get_active_workspace: () => active};
    const ctx = vm.createContext({
        global: {workspace_manager: manager, get_current_time: () => 123, get_window_actors: () => []},
        MethodOverrides: class {},
    });
    const source = fs.readFileSync(path.join(__dirname, '../shell/lifecycle.js'), 'utf8')
        .replace(/^import .*;\s*$/gm, '').replace(/^export class /gm, 'class ');
    vm.runInContext(source + '\nthis.api = {LogicalWorkspaceLifecycle, LogicalWorkspaceOrder};', ctx);
    lifecycle = new ctx.api.LogicalWorkspaceLifecycle({conditionallyEnableAutomaticSwitching() {},
        automaticSwitchingIsEnabled: () => true}, {resolve: () => pointer});
    lifecycle.animation = {selectedMonitor: locked, cancel() { cancellations++; }};
    for (const index of [0, 1]) {
        lifecycle.stacks.set('display-' + index, {index, key: 'display-' + index,
            order: new ctx.api.LogicalWorkspaceOrder([workspaces[0], workspaces[index ? 2 : 3]])});
    }
    return {lifecycle, workspaces, requests, active: () => active, cancellations: () => cancellations};
}

for (const [pointer, locked, monitor] of [[0, null, 0], [1, null, 1], [0, 1, 1], [1, 0, 0]]) {
    const s = setup({pointer, locked});
    s.lifecycle.switchWorkspace(1);
    assert.equal(s.requests.length, 1);
    assert.equal(s.requests[0].animate, true, 'ordinary next keeps the native animation decision');
    assert.equal(s.requests[0].monitor, monitor, 'existing slide selection wins over later pointer position');
    assert.equal(s.active(), s.workspaces[monitor ? 2 : 3]);
    s.lifecycle.switchWorkspace(1);
    assert.equal(s.requests.length, 1, 'logical boundary does not start another animation');
    s.lifecycle.switchWorkspace(-1);
    assert.equal(s.requests[1].animate, true);
    assert.equal(s.active(), s.workspaces[0]);
    assert.equal(s.cancellations(), 0, 'ordinary retargeting must not tear down the existing slide');
}
for (const [pointer, locked, monitor] of [[0, null, 0], [1, null, 1], [0, 1, 1], [1, 0, 0]]) {
    const s = setup({pointer, locked});
    const slot = s.lifecycle.addWorkspace();
    assert.equal(s.requests.length, 1);
    assert.equal(s.requests[0].animate, true, 'adding and selecting a desktop uses the ordinary slide');
    assert.equal(s.requests[0].monitor, monitor);
    assert.equal(s.active(), slot.workspace);
    assert.equal(s.cancellations(), 0);
    const another = s.lifecycle.addWorkspace(monitor, false);
    assert(another);
    assert.equal(s.requests.length, 1, 'unselected desktop creation does not animate or activate');
}
// Fullscreen ownership still calls the explicit immediate/default activation
// policy. Avoid a second workspace slide over the app's fullscreen transition.
{
    const s = setup();
    const stack = s.lifecycle.stackForMonitor(1);
    s.lifecycle.activate(stack, stack.order.slots[1]);
    assert.equal(s.requests[0].animate, false);
    assert.equal(s.requests[0].monitor, 1);
    assert.equal(s.cancellations(), 1);
    assert.equal(s.lifecycle.forcedMonitor, null, 'immediate activation restores its scoped gate');
}
console.log('PASS: ordinary previous/next and desktop creation animate with slide monitor ownership; boundaries/nonselected creation are no-ops; fullscreen/default activation remains immediate');
