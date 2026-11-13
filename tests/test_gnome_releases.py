"""Policy checks for the release monitor, without network access."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('releases', Path(__file__).resolve().parents[1] / 'scripts/check-gnome-releases.py')
releases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(releases)


class ReleaseMonitor(unittest.TestCase):
    def setUp(self):
        self.lock = {'currentMajor': '51', 'previousMajor': '50',
                     'sources': [{'version': '50.6'}, {'version': '51.1'}]}

    def tags(self, *names):
        return [{'name': name} for name in names]

    def test_prereleases_do_not_advance_the_window(self):
        self.assertEqual(releases.pending_updates(self.lock, self.tags('52.alpha', '52.beta', '52.rc', '51.1', '50.6')), [])

    def test_patch_and_stable_major_need_review(self):
        messages = releases.pending_updates(self.lock, self.tags('52.0', '51.2', '50.7', '50.6'))
        self.assertEqual(len(messages), 3)
        self.assertIn('support-window review', messages[0])

    def test_release_comparison_is_numeric(self):
        self.lock['sources'].append({'version': '50.10'})
        self.assertEqual(releases.pending_updates(self.lock, self.tags('51.1', '50.9', '50.10')), [])

    def test_incomplete_results_fail_instead_of_claiming_freshness(self):
        for tags in ([], self.tags('51.1'), self.tags('52.rc')):
            with self.assertRaises(ValueError):
                releases.pending_updates(self.lock, tags)


if __name__ == '__main__':
    unittest.main()
