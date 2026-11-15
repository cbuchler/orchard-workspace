"""Policy checks for the release monitor, without network access."""
import importlib.util
import contextlib
import io
import json
from pathlib import Path
import unittest
from unittest import mock

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

    def test_release_fetch_uses_token_without_printing_it(self):
        lock = json.loads((releases.ROOT / 'tests/fixtures/gnome-shell.json').read_text())
        tags = self.tags(*(source['version'] for source in lock['sources']))
        token = 'test-release-monitor-token'
        def fetch(request, timeout):
            self.assertEqual(timeout, 30)
            self.assertTrue(request.full_url.startswith('https://api.github.com/repos/GNOME/gnome-shell/tags?'))
            if request.get_header('Authorization') != f'Bearer {token}':
                raise releases.urllib.error.HTTPError(request.full_url, 403, 'rate limit exceeded', {}, None)
            return io.StringIO(json.dumps(tags))
        output = io.StringIO()
        with mock.patch.dict(releases.os.environ, {'GITHUB_TOKEN': token}, clear=True), \
                mock.patch.object(releases.sys, 'argv', ['check-gnome-releases.py']), \
                mock.patch.object(releases.urllib.request, 'urlopen', side_effect=fetch), \
                contextlib.redirect_stdout(output):
            self.assertEqual(releases.main(), 0)
        self.assertNotIn(token, output.getvalue())


if __name__ == '__main__':
    unittest.main()
