import copy
import unittest

from run import validate


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


if __name__ == '__main__':
    unittest.main()
