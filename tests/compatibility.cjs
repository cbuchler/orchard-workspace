const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'shell/compatibility.js'), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace(/^export (?=(?:class|function|const)\b)/gm, '');
const noop = () => {};
const methods = names => Object.fromEntries(names.map(name => [name, noop]));
class Window {}
Object.assign(Window.prototype, methods(['activate', 'activate_with_workspace', 'get_transient_for', 'foreach_transient']));
class Workspace {}
Object.assign(Workspace.prototype, methods(['activate_with_focus']));
class App {}
Object.assign(App.prototype, methods(['activate', 'activate_full', 'activate_window', 'get_windows']));
const display = methods(['_updateWorkspacesViews', '_endTouchGesture', '_moveToWorkspace']);
const Main = {wm: {...methods(['_shouldAnimate', 'actionMoveWindow', 'actionMoveWorkspace', 'insertWorkspace', 'handleWorkspaceScroll']),
    _workspaceTracker: methods(['_checkWorkspaces', '_queueCheckWorkspaces']),
    _workspaceAnimation: methods(['_prepareWorkspaceSwitch', '_findMonitorGroup', '_finishWorkspaceSwitch', 'animateSwitch', 'cancelSwitchAnimation'])},
    overview: {_overview: {controls: {_workspacesDisplay: display}}}};
const Config = {PACKAGE_VERSION: '51.0'};
class WorkspaceGroup { _syncStacking() {} }
const ctx = vm.createContext({Config, Meta: {Window, Workspace}, Shell: {App}, Main,
    WorkspaceAnimation: {WorkspaceGroup},
    global: {display: methods(['sort_windows_by_stacking', 'xserver_time_is_before']),
        stage: methods(['connectObject', 'disconnectObject'])}, Extension: class {}});
vm.runInContext(source + '\nthis.api = {assertSupportedVersion, assertShellCompatibility, requireMethods, SUPPORTED_MAJORS};', ctx);
const {assertSupportedVersion, assertShellCompatibility} = ctx.api;
const both = {'shell-version': ['50', '51']};
for (const version of ['50.0', '50.1', '50.12.1', '51.0', '51.99'])
    assert.doesNotThrow(() => assertSupportedVersion(version, both));
for (const version of ['49.9', '52.0', '50.alpha', '51.beta', '51.rc', '52.alpha', '51', '51.0-custom', 'invalid'])
    assert.throws(() => assertSupportedVersion(version, both), /not validated/);
assert.throws(() => assertSupportedVersion('50.0', {'shell-version': ['51']}), /not validated/,
    'policy eligibility must not bypass declared release validation');
assert.doesNotThrow(() => assertShellCompatibility(both));
const nativeMove = display._moveToWorkspace;
delete display._moveToWorkspace;
Object.assign(display, methods(['_onKeyPressEvent', 'prepareToLeaveOverview']));
Config.PACKAGE_VERSION = '50.0';
assert.doesNotThrow(() => assertShellCompatibility(both), 'GNOME 50 legacy API shape is accepted');
const nativeStacking = WorkspaceGroup.prototype._syncStacking;
delete WorkspaceGroup.prototype._syncStacking;
assert.throws(() => assertShellCompatibility(both), /incompatible GNOME 50 WorkspaceGroup: _syncStacking/);
WorkspaceGroup.prototype._syncStacking = nativeStacking;
display._moveToWorkspace = nativeMove;
Config.PACKAGE_VERSION = '51.0';

// Startup must fail before settings, lifecycle initialization, hooks or signal
// installation when the version or a required private API is incompatible.
vm.runInContext(fs.readFileSync(path.join(root, 'extension.js'), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace('export default class ', 'class ') +
    '\nthis.RuntimeExtension = SwitchWorkspacesExtension;', ctx);
const instance = new ctx.RuntimeExtension();
instance.metadata = both;
let settingsReads = 0;
instance.getSettings = () => { settingsReads++; throw new Error('must not read settings'); };
Config.PACKAGE_VERSION = '52.0';
assert.throws(() => instance.enable(), /not validated/);
Config.PACKAGE_VERSION = '51.0';
const original = Main.wm._workspaceAnimation.animateSwitch;
delete Main.wm._workspaceAnimation.animateSwitch;
assert.throws(() => instance.enable(), /incompatible WorkspaceAnimationController: animateSwitch/);
assert.equal(settingsReads, 0);
assert.equal(instance._state, undefined);
Main.wm._workspaceAnimation.animateSwitch = original;

const lock = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/gnome-shell.json'), 'utf8'));
assert.equal(Number(lock.currentMajor), Number(lock.previousMajor) + 1);
assert.deepEqual(Array.from(ctx.api.SUPPORTED_MAJORS).sort(), [lock.previousMajor, lock.currentMajor].sort());
assert.deepEqual([...new Set(lock.sources.map(item => item.version.split('.')[0]))].sort(), Array.from(ctx.api.SUPPORTED_MAJORS).sort());
for (const item of lock.sources) {
    assert.match(item.version, /^\d+\.\d+(?:\.\d+)?$/);
    assert.match(item.commit, /^[a-f0-9]{40}$/);
    for (const spec of Object.values(item.files)) assert.match(spec.sha256, /^[a-f0-9]{64}$/);
}
const workflow = fs.readFileSync(path.join(root, '.github/workflows/gnome-compatibility.yml'), 'utf8');
const versions = workflow.match(/gnome: \[([^\]]+)\]/)[1].match(/'([^']+)'/g).map(value => value.slice(1, -1));
assert.deepEqual(versions.sort(), lock.sources.map(item => item.version).sort(), 'CI must cover exactly the locked current/previous versions');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'metadata.json'), 'utf8'));
assert(metadata['shell-version'].every(major => ctx.api.SUPPORTED_MAJORS.includes(major)));
console.log('PASS: stable current/previous version policy, metadata gate, both API variants, startup failure before mutations, immutable source lock and exact CI matrix');
