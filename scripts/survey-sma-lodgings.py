"""Import public lodging facts from the municipal directory (requires beautifulsoup4).

Usage: python3 scripts/survey-sma-lodgings.py
No map viewport coordinates are imported as accommodation locations.
"""
import json
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, parse_qs, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://sanmartindelosandes.gob.ar'
SOURCE = BASE + '/alojamientos/'

def read(url):
    request = Request(url, headers={'User-Agent': 'AraucanaViajes-lodging-audit/1.0 (contacto@araucana.com.ar)'})
    with urlopen(request, timeout=30) as response:
        return BeautifulSoup(response.read(), 'html.parser')

def records(page):
    for item in page.select('.alojamiento-info_m'):
        heading = item.select_one('.alojamiento-title_m')
        category = heading.select_one('.categoria-estrellas')
        if category:
            category.decompose()
        name = heading.get_text(' ', strip=True)
        name = re.sub(r'\s*["“]Sin categorizar["”]', '', name, flags=re.I).strip()
        details = {}
        for strong in item.select('p strong'):
            label = strong.get_text(' ', strip=True)
            if label in ['Zona:', 'Dirección:']:
                details[label] = strong.parent.get_text(' ', strip=True).removeprefix(label).strip()
        link = urljoin(BASE, item.select_one('a.btn-detalle_m')['href'])
        record = {
            'id': parse_qs(urlparse(link).query)['id'][0],
            'name': name,
            'type': item.select_one('p strong').get_text(' ', strip=True),
            'zone': details.get('Zona:', ''),
            'address': details.get('Dirección:', ''),
            'sourceUrl': link,
        }
        assert all(record.values()), f'Incomplete record: {record}'
        yield record

page = read(SOURCE)
expected = int(re.search(r'Se encontraron (\d+) alojamientos', page.get_text()).group(1))
# The site randomizes results. Preserve its seed across every page to avoid omissions.
links = sorted(set(urljoin(BASE, a['href']) for a in page.select('a[href]')
                   if re.search(r'/alojamientos/page/\d+/', a['href'])),
               key=lambda link: int(re.search(r'/page/(\d+)/', link).group(1)))
all_records = list(records(page))
for index, link in enumerate(links, 2):
    time.sleep(1)
    all_records.extend(records(read(link)))
    print(f'Página {index}: {len(all_records)}/{expected}', flush=True)
assert len(all_records) == expected, (len(all_records), expected)
assert len({r['id'] for r in all_records}) == expected, 'Duplicate IDs: do not publish a partial import'
result = {
    'sourceUrl': SOURCE,
    'retrievedOn': datetime.now(ZoneInfo('America/Argentina/Salta')).date().isoformat(),
    'reportedCount': expected,
    'pageCount': len(links) + 1,
    'lodgings': sorted(all_records, key=lambda item: (item['name'].casefold(), item['id'])),
}
output = ROOT / 'src/lib/airport/data/sma-lodgings.json'
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(f'Saved {expected} unique lodgings to {output}', flush=True)
