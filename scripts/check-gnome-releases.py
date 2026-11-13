#!/usr/bin/env python3
"""Fail when stable upstream GNOME releases need a compatibility refresh."""
import argparse
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]


def pending_updates(lock, tags):
    stable = [item['name'] for item in tags
              if re.fullmatch(r'\d+\.\d+(?:\.\d+)?', item['name'])]
    if not stable:
        raise ValueError('No stable GNOME tags returned; cannot establish freshness')
    key = lambda version: tuple(map(int, version.split('.')))
    current = max(stable, key=key).split('.')[0]
    messages = []
    if current != lock['currentMajor']:
        messages.append(f'Stable GNOME {current} requires a support-window review (policy is {lock["currentMajor"]}/{lock["previousMajor"]})')
    for major in (lock['previousMajor'], lock['currentMajor']):
        releases = [version for version in stable if version.split('.')[0] == major]
        if not releases:
            raise ValueError(f'No stable GNOME {major} tags returned; cannot establish freshness')
        latest = max(releases, key=key)
        locked = [source['version'] for source in lock['sources']]
        if latest not in locked:
            messages.append(f'GNOME {latest} needs source and live validation; locked versions: {", ".join(locked)}')
    return messages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tags-file', type=Path, help='Offline GitHub tags JSON for deterministic checks')
    args = parser.parse_args()
    lock = json.loads((ROOT / 'tests/fixtures/gnome-shell.json').read_text())
    if args.tags_file:
        tags = json.loads(args.tags_file.read_text())
    else:
        # Pagination avoids silently omitting the previous stable major.
        tags = []
        for page in range(1, 11):
            url = f'https://api.github.com/repos/{lock["repository"]}/tags?per_page=100&page={page}'
            request = urllib.request.Request(url, headers={'User-Agent': 'orchard-workspace-compatibility'})
            with urllib.request.urlopen(request, timeout=30) as response:
                batch = json.load(response)
            tags.extend(batch)
            if len(batch) < 100 or any(re.fullmatch(re.escape(lock['previousMajor']) + r'\.\d+(?:\.\d+)?', item['name']) for item in batch):
                break
    updates = pending_updates(lock, tags)
    for update in updates:
        print(update)
    if not updates:
        print('Locked source matrix includes both latest stable maintenance releases')
    return 1 if updates else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, urllib.error.URLError) as error:
        print(f'Cannot establish GNOME release freshness: {error}', file=sys.stderr)
        raise SystemExit(1)
