// Real upstream restacking method + retained clone records. No compositor is
// launched here; the matching GNOME 50 live arrival case is a separate gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname, '..');
const shellSource = process.env.AMW_SHELL_ANIMATION_SOURCE
    ? fs.readFileSync(process.env.AMW_SHELL_ANIMATION_SOURCE, 'utf8')
    : execFileSync('/usr/bin/gresource', ['extract', '/usr/lib/gnome-shell/libshell-51.so',
        '/org/gnome/shell/ui/workspaceAnimation.js'], {encoding: 'utf8'});
const version = process.env.ORCHARD_SHELL_SOURCE_VERSION ?? '51.0';
const Config = {PACKAGE_VERSION: version};
const a = {meta_window: {}}, b = {meta_window: {}}, arrival = {meta_window: {}};
let actors = [a, b];
const ctx = vm.createContext({Config, WorkspaceAnimation: {}, global: {get_window_actors: () => actors}});
const start = shellSource.indexOf('    _syncStacking() {');
const end = shellSource.indexOf('\n    }\n', start);
assert(start >= 0 && end > start, 'upstream WorkspaceGroup restacking method exists');
const native = vm.runInContext(`({${shellSource.slice(start, end + 6)}})._syncStacking`, ctx);
class WorkspaceGroup {}
WorkspaceGroup.prototype._syncStacking = native;
ctx.WorkspaceAnimation.WorkspaceGroup = WorkspaceGroup;
const load = file => fs.readFileSync(path.join(root, file), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace(/^export (?=(?:class|function|const)\b)/gm, '');
vm.runInContext(load('shell/methodOverrides.js') + '\n' + load('shell/compatibility.js') +
    '\nthis.Compatibility = WorkspaceStackingCompatibility;', ctx);
const background = {}, cloneA = {}, cloneB = {};
const group = Object.assign(new WorkspaceGroup(), {_background: background,
    _windowRecords: [{windowActor: a, clone: cloneA}, {windowActor: b, clone: cloneB}],
    _shouldShowWindow: () => true, moves: [],
    set_child_above_sibling(clone, sibling) { this.moves.push([clone, sibling]); }});
group._syncStacking();
assert.deepEqual(group.moves, [[cloneA, background], [cloneB, cloneA]], 'native baseline stacking');
// A real incoming actor becomes eligible after the clone snapshot was built.
actors = [arrival, b, a]; group.moves = [];
const affected = Number(version.split('.')[0]) === 50 && Number(version.split('.')[1]) < 4;
if (affected)
    assert.throws(() => group._syncStacking(), /clone/, 'early GNOME 50 source reproduces missing-record error');
const compatibility = new ctx.Compatibility();
compatibility.enable();
if (!affected)
    assert.equal(WorkspaceGroup.prototype._syncStacking, native, 'fixed GNOME 50 and GNOME 51 keep their native method');
group.moves = []; group._syncStacking();
assert.deepEqual(group.moves, [[cloneB, background], [cloneA, cloneB]], 'sort existing clones by actual stacking without inventing an arrival clone');
assert.equal(group._windowRecords.length, 2);
compatibility.destroy();
assert.equal(WorkspaceGroup.prototype._syncStacking, native, 'disable restores the exact native callable');
if (affected) assert.throws(() => group._syncStacking(), /clone/, 'native behavior is restored after teardown');
// Scope the backport to the exact maintenance boundary checked in upstream tags.
for (const build of ['50.0', '50.1', '50.2', '50.3', '50.3.1', '50.4', '50.6', '51.0', '51.1']) {
    Config.PACKAGE_VERSION = build;
    const adapter = new ctx.Compatibility(); adapter.enable();
    const needsFix = build.startsWith('50.') && Number(build.split('.')[1]) < 4;
    assert.equal(WorkspaceGroup.prototype._syncStacking !== native, needsFix, `adapter scope for ${build}`);
    adapter.destroy();
    assert.equal(WorkspaceGroup.prototype._syncStacking, native);
}
console.log('PASS: real upstream arrival/restacking reproduction, retained clone ordering, 50.4 scope boundary and native restoration');
