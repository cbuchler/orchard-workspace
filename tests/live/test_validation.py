import copy
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import unittest

from run import stop_group, validate


class ValidationTests(unittest.TestCase):
    def state(self):
        before = {'fixtureReady': True, 'candidateActive': True, 'targetMonitor': 0, 'count': 4}
        after = {'targetMonitor': 0, 'returned': True, 'error': None, 'switching': False,
                 'blocks': 0, 'modal': 0, 'active': 3, 'total': 1, 'count': 4,
                 'targetOrder': [0, 3], 'otherSlotPreserved': True, 'otherSlotActive': True,
                 'windows': [{'title': 'ORCHARD FIXTURE ' + str(i), 'workspace': 3 if i in [1, 2] else 0,
                              'visible': i in [1, 2], 'onActive': i in [1, 2]}
                             for i in range(4)]}
        return before, after

    def test_valid_sparse_switch(self):
        before, after = self.state()
        self.assertEqual(validate('native-right', 0, before, after), [])

    def test_reject_physical_neighbor_adoption(self):
        before, after = self.state()
        after.update(active=1, targetOrder=[0, 3, 1])
        failures = validate('native-right', 0, before, after)
        self.assertIn('wrong logical destination', failures)
        self.assertIn('logical order changed or adopted physical neighbor', failures)

    def test_reject_bad_setup_or_wrong_display(self):
        before, after = self.state()
        before['fixtureReady'] = False
        self.assertTrue(validate('native-right', 0, before, after))
        before['fixtureReady'] = True
        self.assertTrue(validate('native-right', 1, before, after))

    def test_reject_hidden_leak_and_modal_grab(self):
        before, after = self.state()
        after['windows'][3]['visible'] = True
        after['modal'] = 1
        failures = validate('native-right', 0, before, after)
        self.assertIn('unrelated hidden window became visible', failures)
        self.assertIn('unexpected modal grab count', failures)

    def test_reject_missing_moving_window_in_replacement(self):
        before, after = self.state()
        after.update(interrupted=True, pendingMovingWindow=None, samples=[{'switching': True, 'movingWindowSticky': False}])
        after['windows'][0].update(workspace=3, visible=True, onActive=True)
        self.assertIn('replacement animation never kept moved window in sticky group',
                      validate('interrupted-move', 0, before, after))
        after['samples'][0]['movingWindowSticky'] = True
        self.assertEqual(validate('interrupted-move', 0, before, after), [])

    def test_fullscreen_requires_adjacent_identity_and_restored_order(self):
        before, after = self.state()
        phase = copy.deepcopy(after)
        phase['windows'][0]['fullscreen'] = True
        phase['fullscreen'] = {'temporaryPosition': 3, 'originPosition': 1, 'sameOrigin': True,
                               'unrelatedOrderPreserved': True}
        after.update(orderRestored=True, originActive=True)
        after['windows'][0].update(fullscreen=False, visible=True)
        self.assertIn('fullscreen desktop is not adjacent to origin',
                      validate('fullscreen-middle', 0, before, after, phase))
        phase['fullscreen']['temporaryPosition'] = 2
        self.assertEqual(validate('fullscreen-middle', 0, before, after, phase), [])

    def test_reject_removal_that_reorders_survivors(self):
        before, after = self.state()
        after.update(removalResult=True, removedRetired=True, removalOrderPreserved=False,
                     activeIdentity=1, targetOrderIdentities=[1, 3])
        after['windows'][0]['visible'] = True
        self.assertIn('removal reordered surviving slots', validate('remove-first', 0, before, after))
        after['removalOrderPreserved'] = True
        self.assertEqual(validate('remove-first', 0, before, after), [])

    def test_rejected_removal_must_preserve_selection(self):
        before, after = self.state()
        after.update(removalResult=False, orderRestored=True, originActive=False, removedRetired=False)
        self.assertIn('rejected removal changed selection/order', validate('remove-final', 0, before, after))
        after['originActive'] = True
        self.assertEqual(validate('remove-final', 0, before, after), [])

    def test_dynamic_renumber_uses_stable_workspace_identity(self):
        before, after = self.state()
        after.update(active=1, activeIdentity=3, targetOrder=[0, 1], targetOrderIdentities=[0, 3])
        self.assertEqual(validate('native-right', 0, before, after), [])

    def test_disabled_candidate_requires_inactive_state(self):
        before, after = self.state()
        before['candidateActive'] = False
        after['active'] = 1
        for window in after['windows']:
            window['visible'] = False
        self.assertEqual(validate('extension-disabled', 0, before, after), [])
        before['candidateActive'] = True
        self.assertIn('candidate activation state wrong before input',
                      validate('extension-disabled', 0, before, after))

    def test_dynamic_pruning_permits_physical_pool_change_with_logical_order_intact(self):
        before, after = self.state()
        after['count'] = 3
        self.assertEqual(validate('native-right', 0, before, after, workspace_mode='dynamic'), [])
        after['targetOrder'] = [0, 1]
        self.assertIn('logical order changed or adopted physical neighbor',
                      validate('native-right', 0, before, after, workspace_mode='dynamic'))

    def test_reject_fixture_display_relocation(self):
        before, after = self.state()
        before['windows'] = copy.deepcopy(after['windows'])
        before['windows'][0]['monitor'] = 0
        after['windows'][0]['monitor'] = 1
        self.assertIn('operation moved a fixture to another display',
                      validate('native-right', 0, before, after))

    def test_persistence_requires_uuid_order_and_selection(self):
        before, after = self.state()
        for window in after['windows']:
            window['workspaceIdentity'] = window['workspace']
        before.update(targetSlotIds=['a', 'b', 'c'], selectedSlotId='c', otherSlotIds=['d', 'e'],
                      otherSelectedSlotId='d', automaticSaveReady=True,
                      windows=copy.deepcopy(after['windows']))
        after.update(candidateActive=True, candidateWasDisabled=True, total=0,
                     targetSlotIds=['a', 'b', 'c'], selectedSlotId='c', otherSlotIds=['d', 'e'], otherSelectedSlotId='d')
        self.assertEqual(validate('persist-reenable', 0, before, after), [])
        after['targetSlotIds'] = ['a', 'c']
        self.assertIn('logical desktop identities/order did not survive re-enable',
                      validate('persist-reenable', 0, before, after))
        after['targetSlotIds'] = before['targetSlotIds']
        after['selectedSlotId'] = 'b'
        self.assertIn('selected desktop identity did not survive re-enable',
                      validate('persist-reenable', 0, before, after))
        after['selectedSlotId'] = 'c'
        after['otherSelectedSlotId'] = 'e'
        self.assertIn('other display selection did not survive restart',
                      validate('persist-reenable', 0, before, after))
        after['otherSelectedSlotId'] = 'd'
        before['automaticSaveReady'] = False
        self.assertIn('automatic layout save did not settle before restart',
                      validate('persist-reenable', 0, before, after))

    def test_cleanup_kills_descendant_after_leader_exits(self):
        child = 'import os,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);print(os.getpid(),flush=True);time.sleep(30)'
        leader = 'import subprocess,sys,time;subprocess.Popen([sys.executable,"-c",sys.argv[1]]);time.sleep(30)'
        process = subprocess.Popen([sys.executable, '-c', leader, child], start_new_session=True,
                                   stdout=subprocess.PIPE, text=True)
        try:
            descendant = int(process.stdout.readline())
            stop_group(process)
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                status = Path(f'/proc/{descendant}/stat')
                if not status.exists() or status.read_text().split()[2] == 'Z':
                    break
                time.sleep(.02)
            else:
                self.fail('TERM-ignoring descendant survived its session leader')
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            process.stdout.close()


if __name__ == '__main__':
    unittest.main()
