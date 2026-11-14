#!/usr/bin/python3
"""Real-window checks in a private, headless GNOME session (never the desktop bus)."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import time

HERE = Path(__file__).resolve().parent
UUID = 'orchard-workspace@cbuchler.github.io'
OBSERVER = 'orchard-activation-test@local'
BUS_PATH = '/org/gnome/Shell/Extensions/OrchardActivationTest'
BUS_INTERFACE = 'org.gnome.Shell.Extensions.OrchardActivationTest'
SHORTCUTS = ['native-right', 'rotated', 'native-number', 'native-last', 'invalid-number',
             'first-boundary', 'last-boundary', 'move-right', 'move-number',
             'move-boundary', 'orchard', 'gesture', 'overview-native',
             'all-displays', 'extension-disabled']
FULLSCREEN = ['fullscreen-first', 'fullscreen-middle', 'fullscreen-last', 'fullscreen-mode-roundtrip',
              'fullscreen-keyboard', 'fullscreen-pointer-other', 'fullscreen-background', 'fullscreen-dialog-other']
REMOVAL = ['remove-first', 'remove-middle', 'remove-last', 'remove-explicit', 'remove-keyboard',
           'remove-occupied', 'remove-final', 'remove-fullscreen-origin', 'remove-fullscreen-last-origin']
CASES = SHORTCUTS + FULLSCREEN + REMOVAL + ['persist-reenable', 'persist-offmode', 'persist-new-shell', 'rapid-native', 'restack-arrival', 'interrupted-move', 'interrupted-gesture-move',
                                  'overview-move', 'animations-disabled-move']
HOST_ENDPOINTS = ['DISPLAY', 'XAUTHORITY', 'SESSION_MANAGER', 'GNOME_KEYRING_CONTROL',
                  'SSH_AUTH_SOCK', 'AT_SPI_BUS_ADDRESS', 'DBUS_STARTER_ADDRESS', 'DBUS_STARTER_BUS_TYPE']


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def isolated_environment(root):
    """Apply before starting D-Bus, including its automatically activated services."""
    return {'XDG_CONFIG_HOME': str(root / 'config'), 'XDG_DATA_HOME': str(root / 'data'),
            'XDG_CACHE_HOME': str(root / 'cache'), 'XDG_STATE_HOME': str(root / 'state'),
            'XDG_RUNTIME_DIR': str(root / 'runtime'), 'GSETTINGS_BACKEND': 'keyfile',
            'GNOME_SHELL_SESSION_MODE': 'user', 'WAYLAND_DISPLAY': 'orchard-test',
            'XDG_DATA_DIRS': '/usr/local/share:/usr/share', 'LIBGL_ALWAYS_SOFTWARE': '1'}


def stop_group(process):
    """Drain our private group even if its leader exits before its descendants."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()


def validate(case, monitor, before, after, intermediate=None, workspace_mode='fixed'):
    """Return concrete invariant failures; unexpected setup never counts as a pass."""
    failures = []

    def check(value, message):
        if not value:
            failures.append(message)

    check(before.get('fixtureReady'), 'fixture placement/workspace/focus preconditions failed')
    check(before.get('targetMonitor') == monitor and after.get('targetMonitor') == monitor,
          'requested test display does not match observer')
    check(bool(before.get('candidateActive')) == (case != 'extension-disabled'),
          'candidate activation state wrong before input')
    check(after.get('error') is None, 'observer error: ' + str(after.get('error')))
    check(after.get('returned'), 'test operation did not return')
    check(not after.get('switching'), 'workspace animation retained')
    check(after.get('blocks') == 0, 'workspace-update block retained')
    check(after.get('modal') == (1 if case in ['overview-native', 'overview-move'] else 0), 'unexpected modal grab count')
    windows = {w['title'][-1]: w for w in after.get('windows', [])}
    check(set(windows) == {'0', '1', '2', '3'}, 'fixture window missing or unexpected')
    if len(windows) != 4:
        return failures
    previous = {w['title'][-1]: w for w in before.get('windows', [])}
    if previous:
        check(all(w.get('monitor') == previous[i].get('monitor') for i, w in windows.items()),
              'operation moved a fixture to another display')

    if case.startswith('persist-'):
        check(after.get('candidateActive'), 'candidate not active after restart')
        if case != 'persist-new-shell':
            check(after.get('candidateWasDisabled'), 'candidate did not disable and re-enable')
            if case == 'persist-offmode':
                check(after.get('startedInAllDisplays') and after.get('resumedIndependentMode'), 'all-displays startup was not exercised')
        else:
            check(after.get('resumed') and after.get('fixtureReady'), 'fresh Shell observation/fixtures failed')
            check(after.get('fullscreenOwners') == 0, 'fresh Shell restored temporary fullscreen ownership')
        check(before.get('targetSlotIds') and all(before['targetSlotIds']) and
              after.get('targetSlotIds') == before['targetSlotIds'], 'logical desktop identities/order did not survive re-enable')
        check(after.get('selectedSlotId') == before.get('selectedSlotId'), 'selected desktop identity did not survive re-enable')
        check(after.get('otherSlotIds') == before.get('otherSlotIds'), 'other display layout changed on re-enable')
        check(before.get('otherSelectedSlotId') and after.get('otherSelectedSlotId') == before['otherSelectedSlotId'],
              'other display selection did not survive restart')
        check(before.get('automaticSaveReady'), 'automatic layout save did not settle before restart')
        check(after.get('total') == 0, 're-enable unexpectedly activated a workspace')
        if case != 'persist-new-shell':
            check(previous and all(w.get('workspaceIdentity') == previous[i].get('workspaceIdentity') and
                  w['visible'] == previous[i]['visible'] for i, w in windows.items()), 're-enable relocated or hid a fixture window')
    elif case in REMOVAL:
        rejected = case in ['remove-occupied', 'remove-final']
        if rejected:
            check(after.get('removalResult') is False, 'unsafe removal was not rejected')
            check(after.get('orderRestored') and after.get('originActive'), 'rejected removal changed selection/order')
            check(not after.get('removedRetired'), 'rejected removal retired origin')
        else:
            phase = intermediate or after
            if case != 'remove-keyboard':
                check(phase.get('removalResult') is True, 'empty desktop removal was not accepted')
            check(phase.get('removedRetired'), 'removed slot was not retired')
            check(phase.get('removalOrderPreserved'), 'removal reordered surviving slots')
            if case.startswith('remove-fullscreen'):
                check(after.get('fullscreenOwners') == 0 and not windows['0'].get('fullscreen'), 'fullscreen owner not released')
                check(windows['0']['visible'], 'fullscreen return window is hidden')
                if case.endswith('last-origin'):
                    check(after.get('targetSlotCount') == 1, 'last fullscreen slot was not retained as ordinary desktop')
                else:
                    check(after.get('targetOrderIdentities') == [1, 3], 'fullscreen return resurrected retired origin')
            else:
                first = 1 if case == 'remove-middle' else 3 if case == 'remove-last' else 0
                check(after.get('activeIdentity') == (0 if first == 1 else 1), 'removal selected wrong neighbor')
                check(after.get('targetOrderIdentities') == [i for i in [0, 1, 3] if i != first], 'wrong surviving logical order')
                check(windows['0']['visible'], 'neighbor window not visible after removal')
                if case == 'remove-explicit':
                    check(any(s.get('selectedMonitor') == monitor for s in after.get('samples', [])), 'explicit removal animated wrong display')
    elif case.startswith('fullscreen-'):
        phase = intermediate or {}
        fs = phase.get('fullscreen') or {}
        origin = {'fullscreen-first': 0, 'fullscreen-middle': 1, 'fullscreen-last': 2}.get(case, 1)
        check(fs.get('temporaryPosition') == origin + 1, 'fullscreen desktop is not adjacent to origin')
        check(fs.get('originPosition') == origin and fs.get('sameOrigin'), 'fullscreen origin identity changed')
        check(fs.get('unrelatedOrderPreserved'), 'fullscreen reordered unrelated desktops')
        if case == 'fullscreen-mode-roundtrip':
            check(phase.get('fullscreenModeRoundtrip'), 'fullscreen mode round-trip was not exercised')
        check(phase.get('otherSlotPreserved') and phase.get('otherSlotActive'), 'fullscreen changed other display selection')
        check(phase.get('windows') and next(w for w in phase['windows'] if w['title'].endswith('0')).get('fullscreen'),
              'real window did not enter fullscreen')
        check(phase.get('focus') == before.get('focus'), 'fullscreen entry changed keyboard focus')
        check(after.get('orderRestored'), 'fullscreen exit did not restore original slot order')
        check(after.get('originActive'), 'fullscreen exit did not select origin')
        check(not windows['0'].get('fullscreen'), 'real window did not leave fullscreen')
        check(windows['0']['visible'], 'returned fullscreen window is hidden')
        check(after.get('focus') == before.get('focus'), 'fullscreen exit changed keyboard focus')
    elif case in ['all-displays', 'extension-disabled']:
        target = before.get('rightNeighborIdentity', 1)
        check(after.get('activeIdentity', after.get('active')) == target and after.get('total') == 1,
              'native global fallback selected wrong workspace')
        previous = {w['title'][-1]: w for w in before.get('windows', [])}
        if previous:
            check(all(w.get('workspaceIdentity', w['workspace']) == previous[i].get('workspaceIdentity', previous[i]['workspace'])
                      for i, w in windows.items()), 'native global fallback relocated windows')
            check(all(w['visible'] == (w.get('workspaceIdentity', w['workspace']) == target)
                      for w in windows.values()), 'native global fallback shows wrong workspace windows')
        else:
            check(not any(w['visible'] for w in windows.values()), 'fallback did not hide old global workspaces')
    else:
        initial = 3 if case in ['rotated', 'last-boundary'] else 0
        noop = case in ['invalid-number', 'first-boundary', 'last-boundary', 'move-boundary']
        target = initial if noop else 0 if case in ['rotated', 'rapid-native'] else 3
        order = [3, 0] if case == 'rotated' else [0, 3]
        check(after.get('activeIdentity', after.get('active')) == target, 'wrong logical destination')
        check(after.get('targetOrderIdentities', after.get('targetOrder')) == order, 'logical order changed or adopted physical neighbor')
        check(after.get('total') == (0 if noop else 2 if case == 'rapid-native' else 1), 'unexpected workspace-change count')
        if workspace_mode == 'fixed':
            check(after.get('count') == before.get('count'), 'shortcut created/removed a physical workspace')
        if case.startswith('move') or case.endswith('-move'):
            check(windows['0'].get('workspaceIdentity', windows['0']['workspace']) == target and windows['0']['visible'], 'moved window not visible at destination')
        elif case == 'rapid-native':
            check(windows['0']['visible'] and not windows['1']['visible'], 'rapid reversal shows wrong desktop')
            if before.get('physicalOrderIdentities') == after.get('physicalOrderIdentities'):
                check(after.get('actorsReused'), 'rapid reversal replaced animation actors')
        elif not noop:
            check(windows['1']['visible'] and not windows['0']['visible'], 'selected display shows wrong desktop windows')
        if case.endswith('-move'):
            check(after.get('interrupted'), 'test did not start an existing real animation')
            check(after.get('pendingMovingWindow') is None, 'moving-window ownership retained after activation')
            if case not in ['overview-move', 'animations-disabled-move']:
                check(any(s.get('movingWindowSticky') for s in after.get('samples', [])),
                      'replacement animation never kept moved window in sticky group')
    if case not in ['all-displays', 'extension-disabled'] and not case.startswith('persist-'):
        check(after.get('otherSlotPreserved') and after.get('otherSlotActive'), 'other display lost its selected logical slot')
        check(windows['2']['visible'] and windows['2']['onActive'], 'unrelated visible window disappeared')
        if case != 'restack-arrival':
            check(not windows['3']['visible'] and not windows['3']['onActive'], 'unrelated hidden window became visible')
        else:
            check(windows['3']['visible'] and windows['3']['onActive'], 'explicitly arriving window was not shown')
    return failures


def worker(args):
    # Parent launches this process inside dbus-run-session; set isolation before
    # importing Gio or running gsettings. No host-session bus or settings used.
    if os.environ.get('ORCHARD_LIVE_WORKER_ALLOWED') != '1' or not os.environ.get('DBUS_SESSION_BUS_ADDRESS') or \
            os.environ['DBUS_SESSION_BUS_ADDRESS'] == os.environ.get('ORCHARD_LIVE_PARENT_BUS'):
        raise RuntimeError('Worker requires a new private D-Bus session launched by the parent')
    root = args.output.resolve()
    for name in ['config', 'data', 'cache', 'state', 'runtime']:
        (root / name).mkdir(parents=True, exist_ok=True)
    os.chmod(root / 'runtime', 0o700)
    os.environ.update(isolated_environment(root))
    os.environ.update(ORCHARD_SHORTCUT_CASE=args.case, ORCHARD_TEST_OUTPUT=str(root))
    for key in HOST_ENDPOINTS:
        os.environ.pop(key, None)
    version = subprocess.check_output([args.shell, '--version'], text=True).strip()
    major = re.search(r'\b(\d+)\.', version).group(1)
    if args.require_major and major != args.require_major:
        raise RuntimeError(f'Required GNOME {args.require_major}, binary reports {version}')
    extension_root = root / 'data/gnome-shell/extensions'
    candidate = extension_root / UUID
    shutil.copytree(args.extension_source, candidate, ignore=shutil.ignore_patterns(
        '.git', 'graphify-out', 'dist', 'tests', '.github', '__pycache__'))
    subprocess.run(['/usr/bin/glib-compile-schemas', str(candidate / 'schemas')], check=True)
    observer = extension_root / OBSERVER
    observer.mkdir()
    write_json(observer / 'metadata.json', {'uuid': OBSERVER, 'name': 'Orchard isolated live tests',
               'description': 'Temporary test observer', 'shell-version': [major]})
    shutil.copy2(HERE / 'observer.js', observer / 'extension.js')
    manifest = {str(p.relative_to(candidate)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in candidate.rglob('*') if p.is_file() and p.suffix in ['.js', '.json', '.xml']}
    write_json(root / 'candidate-files.json', manifest)
    write_json(root / 'harness-files.json', {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
               for p in [HERE / 'run.py', HERE / 'observer.js', HERE / 'fixtures.py']})
    settings = [('org.gnome.desktop.screensaver', 'lock-enabled', 'false'),
                ('org.gnome.desktop.session', 'idle-delay', '0'),
                ('org.gnome.mutter', 'dynamic-workspaces', 'true' if args.workspace_mode == 'dynamic' else 'false'),
                ('org.gnome.mutter', 'workspaces-only-on-primary', 'false'),
                ('org.gnome.desktop.wm.preferences', 'num-workspaces', '4'),
                ('org.gnome.shell', 'disable-user-extensions', 'false'),
                # Shell unwinds extensions enabled after one being disabled.
                # Keep the observer first so it survives candidate cycling.
                ('org.gnome.shell', 'enabled-extensions', repr([OBSERVER, UUID])),
                ('org.gnome.shell', 'disabled-extensions', '[]')]
    for key, value in {'switch-to-workspace-right': "['<Super><Alt>Right']",
                       'switch-to-workspace-left': "['<Super><Alt>Left']",
                       'switch-to-workspace-2': "['<Super><Alt>2']",
                       'switch-to-workspace-4': "['<Super><Alt>4']",
                       'switch-to-workspace-last': "['<Super><Alt>End']",
                       'move-to-workspace-right': "['<Super><Alt><Shift>Right']",
                       'move-to-workspace-left': "['<Super><Alt><Shift>Left']",
                       'move-to-workspace-2': "['<Super><Alt><Shift>2']"}.items():
        settings.append(('org.gnome.desktop.wm.keybindings', key, value))
    for schema, key, value in settings:
        subprocess.run(['/usr/bin/gsettings', 'set', schema, key, value], check=True)
    from gi.repository import Gio, GLib
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)

    def call(name, parameters=None):
        return bus.call_sync('org.gnome.Shell', BUS_PATH, BUS_INTERFACE, name, parameters,
                             None, Gio.DBusCallFlags.NONE, 10000, None).unpack()

    def snapshot():
        return json.loads(call('Snapshot')[0])

    def until(predicate, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if children[0].poll() is not None:
                raise RuntimeError('Isolated Shell exited; see shell.log')
            try:
                state = snapshot()
                if predicate(state):
                    return state
            except GLib.Error:
                pass
            time.sleep(.2)
        raise RuntimeError('Timed out waiting for isolated compositor/fixtures')

    def capture(label):
        call('Capture', GLib.Variant('(s)', (label,)))
        state = until(lambda state: label in state.get('captureComplete', []) or state.get('captureErrors'))
        if state.get('captureErrors'):
            write_json(root / f'capture-{label}-errors.json', state['captureErrors'])
            raise RuntimeError('screenshot capture failed: ' + str(state['captureErrors']))
        return state

    children = []
    def stop_children():
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
        for child in reversed(children):
            try:
                child.wait(timeout=4)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()

    def launch_shell(filename):
        if args.case.startswith('persist-'):
            # Ensure the observer is loaded first, regardless of directory
            # enumeration order, so Shell never unwinds it with the candidate.
            subprocess.run(['/usr/bin/gsettings', 'set', 'org.gnome.shell',
                            'enabled-extensions', repr([OBSERVER])], check=True)
        with (root / filename).open('w') as log:
            children.append(subprocess.Popen([args.shell, '--headless', '--wayland',
                '--wayland-display=orchard-test', '--virtual-monitor=1280x800',
                '--virtual-monitor=1024x768'], stdout=log, stderr=subprocess.STDOUT))
        if args.case.startswith('persist-'):
            until(lambda state: state.get('observerReady'))
            call('EnableCandidate')
        until(lambda state: state.get('candidateActive'))

    def launch_fixtures():
        for number in range(4):
            if args.case == 'fullscreen-dialog-other' and number == 1:
                continue  # Window 1 is the real transient created by client 0.
            with (root / f'fixture-{number}.log').open('a') as log:
                children.append(subprocess.Popen(['/usr/bin/python3', str(HERE / 'fixtures.py'),
                    str(number)], stdout=log, stderr=subprocess.STDOUT))
        until(lambda state: len(state.get('windows', [])) == 4)

    try:
        launch_shell('shell.log')
        launch_fixtures()
        time.sleep(1)
        for attempt in range(5):
            call('Setup', GLib.Variant('(i)', (args.monitor,)))
            time.sleep(1)
            if snapshot().get('fixtureReady'):
                break
        else:
            write_json(root / 'invalid-setup.json', snapshot())
            raise RuntimeError('Wayland fixture placements did not settle')
        call('Prepare')
        time.sleep(1 if args.case in ['overview-native', 'overview-move'] else .3)
        if args.case.startswith('persist-'):
            until(lambda state: state.get('automaticSaveReady'))
        before = snapshot()
        write_json(root / 'before.json', before)
        if not before.get('fixtureReady'):
            raise RuntimeError('Fixture preconditions changed after preparation')
        capture('before')
        if args.case == 'persist-new-shell':
            first_pid = children[0].pid
            stop_children()
            children.clear()
            launch_shell('restart-shell.log')
            write_json(root / 'restart.json', {'firstPid': first_pid, 'secondPid': children[0].pid})
            launch_fixtures()
            time.sleep(1)
            call('Resume', GLib.Variant('(i)', (args.monitor,)))
            until(lambda state: state.get('fixtureReady'))
        else:
            call('Activate')
            time.sleep(1.3)
        if args.case in ['persist-reenable', 'persist-offmode']:
            until(lambda state: state.get('candidateActive') and state.get('candidateWasDisabled') and
                  (args.case != 'persist-offmode' or state.get('resumedIndependentMode')))
        intermediate = None
        if args.case.startswith(('fullscreen-', 'remove-fullscreen')):
            intermediate = snapshot()
            write_json(root / 'fullscreen.json', intermediate)
            capture('fullscreen')
            call('ExitFullscreen')
            time.sleep(1.3)
        after = snapshot()
        write_json(root / 'after.json', after)
        captured = capture('after')
        runtime_log = '\n'.join(path.read_text().split('Shutting down GNOME Shell', 1)[0]
                                for path in [root / 'shell.log', root / 'restart-shell.log'] if path.exists())
        failures = validate(args.case, args.monitor, before, after, intermediate, args.workspace_mode)
        if captured.get('captureErrors'):
            failures.append('screenshot capture failed: ' + str(captured['captureErrors']))
        if 'JS ERROR:' in runtime_log:
            failures.append('runtime JS error; inspect shell.log')
        result = {'case': args.case, 'monitor': args.monitor, 'shellVersion': version, 'workspaceMode': args.workspace_mode,
                  'pass': not failures, 'failures': failures,
                  'runtimeJsErrors': runtime_log.count('JS ERROR:'), 'captureErrors': captured.get('captureErrors', [])}
        write_json(root / 'result.json', result)
        return result
    finally:
        stop_children()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extension-source', type=Path, default=HERE.parents[1])
    parser.add_argument('--output', type=Path)
    parser.add_argument('--case', action='append', choices=CASES)
    parser.add_argument('--monitor', type=int, choices=[0, 1])
    parser.add_argument('--jobs', type=int, choices=[1, 2], default=1)
    parser.add_argument('--shell', default='/usr/bin/gnome-shell')
    parser.add_argument('--require-major', choices=['50', '51'])
    parser.add_argument('--workspace-mode', choices=['fixed', 'dynamic'], default='fixed')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        args.case = args.case[0]
        worker(args)
        return
    if args.output and args.output.exists() and any(args.output.iterdir()):
        parser.error('output directory must be empty; preserve earlier evidence')
    output = (args.output or Path(tempfile.mkdtemp(prefix='orchard-live-'))).resolve()
    output.mkdir(parents=True, exist_ok=True)
    dbus = shutil.which('dbus-run-session')
    if not dbus:
        parser.error('dbus-run-session is required')
    cases = args.case or SHORTCUTS
    monitors = [args.monitor] if args.monitor is not None else [0, 1]
    source = args.extension_source.resolve()
    identity = {'extensionSource': str(source), 'shellBinary': args.shell, 'workspaceMode': args.workspace_mode}
    for key, command in [('commit', ['git', 'rev-parse', 'HEAD']),
                         ('worktreeStatus', ['git', 'status', '--porcelain=v1'])]:
        run = subprocess.run(command, cwd=source, text=True, capture_output=True)
        identity[key] = run.stdout.strip() if run.returncode == 0 else None
    write_json(output / 'source.json', identity)
    active = set()
    lock = threading.Lock()
    stopping = threading.Event()

    def run_case(item):
        case, monitor = item
        root = output / f'{case}-{monitor}'
        root.mkdir()  # Refuse to overwrite prior evidence.
        for name in ['config', 'data', 'cache', 'state', 'runtime']:
            (root / name).mkdir()
        os.chmod(root / 'runtime', 0o700)
        command = [dbus, '--', '/usr/bin/python3', str(Path(__file__).resolve()), '--worker',
                   '--extension-source', str(source), '--output', str(root), '--case', case,
                   '--monitor', str(monitor), '--shell', args.shell, '--workspace-mode', args.workspace_mode]
        if args.require_major:
            command += ['--require-major', args.require_major]
        try:
            environment = os.environ.copy()
            environment.update(isolated_environment(root))
            environment.update(ORCHARD_LIVE_WORKER_ALLOWED='1',
                               ORCHARD_LIVE_PARENT_BUS=os.environ.get('DBUS_SESSION_BUS_ADDRESS', ''))
            for key in HOST_ENDPOINTS + ['DBUS_SESSION_BUS_ADDRESS']:
                environment.pop(key, None)
            with (root / 'driver.log').open('w') as log:
                with lock:
                    if stopping.is_set():
                        return {'case': case, 'monitor': monitor, 'pass': False, 'failures': ['run interrupted']}
                    process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                               start_new_session=True, env=environment)
                    active.add(process)
                try:
                    returncode = process.wait(timeout=90)
                finally:
                    stop_group(process)
                    with lock:
                        active.discard(process)
            result = json.loads((root / 'result.json').read_text()) if (root / 'result.json').exists() else {
                'case': case, 'monitor': monitor, 'pass': False, 'failures': ['worker failed; inspect driver.log']}
            if returncode != 0:
                result['pass'] = False
                result['failures'].append('worker exit ' + str(returncode))
        except subprocess.TimeoutExpired:
            result = {'case': case, 'monitor': monitor, 'pass': False, 'failures': ['worker timed out']}
        logs = [path.read_text() for path in [root / 'shell.log', root / 'restart-shell.log'] if path.exists()]
        result['teardownJsErrors'] = sum(log.split('Shutting down GNOME Shell', 1)[1].count('JS ERROR:')
                                         for log in logs if 'Shutting down GNOME Shell' in log)
        return result

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        try:
            for result in pool.map(run_case, [(case, monitor) for case in cases for monitor in monitors]):
                results.append(result)
                write_json(output / 'results.json', results)
                print(json.dumps(result), flush=True)
        except BaseException:
            stopping.set()
            with lock:
                for process in active:
                    stop_group(process)
            raise
    print('Evidence: ' + str(output.resolve()))
    raise SystemExit(0 if all(result['pass'] for result in results) else 1)


if __name__ == '__main__':
    main()
