#!/usr/bin/env python3
"""Run model/source tests against hash-checked, immutable GNOME source fixtures.

This does not start GNOME Shell or establish live compositor compatibility.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'tests/fixtures/gnome-shell.json'


def checked_source(cache, filename, spec, repository, commit, offline):
    path = cache / filename
    digest = lambda data: hashlib.sha256(data).hexdigest()
    if path.exists() and digest(path.read_bytes()) == spec['sha256']:
        return path
    if offline:
        raise RuntimeError(f'Missing or changed fixture: {path}')
    url = f'https://raw.githubusercontent.com/{repository}/{commit}/{spec["path"]}'
    request = urllib.request.Request(url, headers={'User-Agent': 'orchard-workspace-source-tests'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
    if digest(data) != spec['sha256']:
        raise RuntimeError(f'Fixture hash mismatch: {url}')
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
    temporary.replace(path)
    return path


def main():
    lock = json.loads(LOCK.read_text())
    versions = [source['version'] for source in lock['sources']]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', choices=['all', *versions], default='all')
    default_cache = Path(os.environ.get('XDG_CACHE_HOME', Path.home() / '.cache')) / 'orchard-workspace/gnome-sources'
    parser.add_argument('--cache-dir', type=Path, default=default_cache)
    parser.add_argument('--offline', action='store_true', help='Validate existing cache without downloading')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    results = []
    success = True
    for source in lock['sources']:
        version = source['version']
        if args.version not in ('all', version):
            continue
        cache = args.cache_dir.resolve() / version
        env = os.environ.copy()
        provenance = {}
        for filename, spec in source['files'].items():
            path = checked_source(cache, filename, spec, lock['repository'], source['commit'], args.offline)
            provenance[filename] = {'path': str(path), 'upstreamPath': spec['path'], 'sha256': spec['sha256']}
            if 'env' in spec:
                env[spec['env']] = str(path)
        env['ORCHARD_SHELL_SOURCE_VERSION'] = version
        env['ORCHARD_SHELL_SOURCE_DIR'] = str(cache)
        result = {'version': version, 'commit': source['commit'], 'evidence': 'source/model only',
                  'files': provenance, 'tests': []}
        print(f'GNOME Shell {version} ({source["commit"]}): hash-checked source/model tests', flush=True)
        if not args.prepare_only:
            for test in sorted((ROOT / 'tests').glob('*.cjs')):
                if test.name == 'runtime-source.cjs':
                    continue
                run = subprocess.run(['node', str(test)], cwd=ROOT, env=env, text=True, capture_output=True)
                result['tests'].append({'test': str(test.relative_to(ROOT)), 'exitCode': run.returncode,
                                        'output': run.stdout + run.stderr})
                success = success and run.returncode == 0
                print(f'{"PASS" if run.returncode == 0 else "FAIL"} {test.name}', flush=True)
                if run.returncode:
                    print(run.stdout + run.stderr, flush=True)
        results.append(result)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps({'schemaVersion': 1, 'results': results}, indent=2) + '\n')
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
