#!/usr/bin/env python3
"""
Rebuild both printable documents: the English test plan and the Arabic catalog.

── Why this is a script and not a one-off ────────────────────────────────────
The plan changes every time the app does, and a stale PDF is worse than none:
somebody follows it, hits a screen that no longer exists, and reports a fault
against the document rather than the software. Regenerating has to be one
command or it will not happen.

    python3 scripts/build-test-plan-pdf.py

The test plan is generated from TEST-PLAN.md, which is the single source of
truth; the Arabic catalog is hand-authored HTML and is only printed. Both PDFs
are gitignored — the repository is public and neither belongs in it.

Chrome renders it. `--print-to-pdf` is headless Chrome's own print path, so the
@page rules, the page breaks and the checkbox squares come out as the CSS
describes rather than as an approximation.

The markdown here is deliberately small — it handles exactly what TEST-PLAN.md
uses and nothing else. A general converter would be a dependency, a lockfile
entry and a supply-chain surface for a document nobody outside this repository
will ever read.
"""
import html
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'TEST-PLAN.md'
HTML_OUT = ROOT / 'docs' / 'VO-TEST-PLAN.html'
PDF_OUT = ROOT / 'docs' / 'VO-TEST-PLAN.pdf'
AR_HTML = ROOT / 'docs' / 'VO-CATALOG-AR.html'
AR_PDF = ROOT / 'docs' / 'VO-CATALOG-AR.pdf'

CHROME_CANDIDATES = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

CSS = """
@page { size: A4; margin: 16mm 15mm 14mm 15mm; }
* { box-sizing: border-box; }
:root{--ink:#16202c;--muted:#5d6874;--line:#e0e5ea;--accent:#134e57;--soft:#eef5f6;--red:#9b2f2f;--amber:#8a5a12;}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;font-family:"Inter","Helvetica Neue",system-ui,sans-serif;color:var(--ink);font-size:10.4pt;line-height:1.68;}
code,pre{font-family:"SF Mono",Menlo,Consolas,monospace;font-size:9pt;}
pre{background:#f6f8f9;border:1px solid var(--line);border-left:3px solid var(--accent);padding:3mm 4mm;white-space:pre-wrap;margin:3mm 0;page-break-inside:avoid;}
code{background:#f0f3f4;padding:0 1mm;border-radius:2px;}
pre code{background:none;padding:0;}
h1{font-size:17pt;margin:0 0 4mm;padding:3mm 0 2.5mm;border-bottom:2.5px solid var(--accent);page-break-before:always;page-break-after:avoid;}
h1:first-of-type{page-break-before:auto;}
h2{font-size:13pt;margin:8mm 0 3mm;color:var(--accent);page-break-after:avoid;}
h3{font-size:11pt;margin:5mm 0 2mm;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);page-break-after:avoid;}
p{margin:0 0 2.5mm;}
ul,ol{margin:0 0 3mm;padding-left:6mm;}
li{margin-bottom:1.2mm;}
table{width:100%;border-collapse:collapse;margin:3mm 0 4mm;font-size:9.4pt;page-break-inside:avoid;}
th,td{border:1px solid var(--line);padding:1.8mm 2.5mm;text-align:left;vertical-align:top;}
th{background:var(--soft);font-weight:700;}
blockquote{margin:3mm 0;padding:2.5mm 4mm;background:#fdf6e8;border-left:3px solid var(--amber);color:#5c4412;font-size:9.8pt;page-break-inside:avoid;}
blockquote p{margin:0;}
hr{border:0;border-top:1px solid var(--line);margin:6mm 0;}
strong{font-weight:700;}
.check{list-style:none;padding-left:0;}
.check li{position:relative;padding-left:7mm;margin-bottom:1.6mm;}
.check li::before{content:"";position:absolute;left:0;top:1.1mm;width:3.6mm;height:3.6mm;border:1.2px solid var(--accent);border-radius:1px;background:#fff;}
.cover{page-break-after:always;padding-top:60mm;}
.cover h1{page-break-before:auto;border:0;font-size:30pt;line-height:1.25;margin-bottom:6mm;padding:0;}
.cover .sub{font-size:13pt;color:var(--muted);max-width:130mm;line-height:1.7;}
.cover .rule{width:38mm;height:3px;background:var(--accent);margin:8mm 0;}
.cover .meta{margin-top:16mm;font-size:10pt;color:var(--muted);}
"""

COVER = """<section class="cover">
<h1>VO Capture &amp; Control<br>Full Test Plan</h1>
<div class="rule"></div>
<div class="sub">Twenty-two stages, in order, from an empty database to a
variation that has been captured, noticed, priced, approved, submitted,
chased and paid. Nothing is created for you.</div>
<div class="meta">September 2026 &nbsp;·&nbsp; One company, four projects, nine people, one handset</div>
</section>"""


def inline(text: str) -> str:
    """Escape first, then re-introduce the few marks the plan actually uses."""
    out = html.escape(text, quote=False)
    out = re.sub(r'`([^`]+)`', r'<code>\1</code>', out)
    out = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', out)
    return out


def render(md: str) -> str:
    lines = md.split('\n')
    out: list[str] = []
    i = 0
    # A checklist is a list of "- [ ]" items and gets the drawn boxes; an
    # ordinary bullet list must not, or every note in the document looks like
    # something waiting to be ticked.
    while i < len(lines):
        line = lines[i]

        if line.startswith('```'):
            i += 1
            body: list[str] = []
            while i < len(lines) and not lines[i].startswith('```'):
                body.append(lines[i])
                i += 1
            i += 1
            out.append('<pre><code>' + html.escape('\n'.join(body)) + '</code></pre>')
            continue

        if line.startswith('|'):
            block: list[str] = []
            while i < len(lines) and lines[i].startswith('|'):
                block.append(lines[i])
                i += 1
            cells = [
                [c.strip() for c in row.strip().strip('|').split('|')]
                for row in block
                if not re.match(r'^\|[\s:|-]+\|$', row.strip())
            ]
            if cells:
                head, *rest = cells
                rows = ['<tr>' + ''.join(f'<th>{inline(c)}</th>' for c in head) + '</tr>']
                rows += [
                    '<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in row) + '</tr>'
                    for row in rest
                ]
                out.append('<table>' + ''.join(rows) + '</table>')
            continue

        if line.startswith('- [ ]') or line.startswith('- [x]'):
            items: list[str] = []
            while i < len(lines) and (
                lines[i].startswith('- [ ]') or lines[i].startswith('- [x]')
                or (items and lines[i].startswith('      '))
            ):
                if lines[i].startswith('      ') and items:
                    items[-1] += ' ' + inline(lines[i].strip())
                else:
                    items.append(inline(lines[i][5:].strip()))
                i += 1
            out.append('<ul class="check">' + ''.join(f'<li>{x}</li>' for x in items) + '</ul>')
            continue

        if re.match(r'^[-*] ', line):
            items = []
            while i < len(lines) and re.match(r'^[-*] ', lines[i]):
                items.append(inline(lines[i][2:].strip()))
                i += 1
            out.append('<ul>' + ''.join(f'<li>{x}</li>' for x in items) + '</ul>')
            continue

        if re.match(r'^\d+\. ', line):
            items = []
            while i < len(lines) and re.match(r'^\d+\. ', lines[i]):
                items.append(inline(re.sub(r'^\d+\. ', '', lines[i]).strip()))
                i += 1
            out.append('<ol>' + ''.join(f'<li>{x}</li>' for x in items) + '</ol>')
            continue

        if line.startswith('>'):
            quote = []
            while i < len(lines) and lines[i].startswith('>'):
                quote.append(lines[i].lstrip('>').strip())
                i += 1
            out.append('<blockquote><p>' + inline(' '.join(quote)) + '</p></blockquote>')
            continue

        heading = re.match(r'^(#{1,4}) (.+)$', line)
        if heading:
            level = len(heading.group(1))
            out.append(f'<h{level}>{inline(heading.group(2))}</h{level}>')
            i += 1
            continue

        if line.strip() in ('---', '***'):
            out.append('<hr>')
            i += 1
            continue

        if line.strip():
            para = [line.strip()]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(
                r'^(#{1,4} |[-*] |\d+\. |\||>|```|---)', lines[i]
            ):
                para.append(lines[i].strip())
                i += 1
            out.append('<p>' + inline(' '.join(para)) + '</p>')
            continue

        i += 1

    return '\n'.join(out)


def to_pdf(chrome: str, source: Path, target: Path) -> None:
    subprocess.run(
        [
            chrome, '--headless', '--disable-gpu', '--no-sandbox',
            f'--print-to-pdf={target}', '--no-pdf-header-footer',
            # Arabic shaping and the webfont fallbacks need a moment; without a
            # budget Chrome prints before the page has settled and the RTL runs
            # come out in the wrong order.
            '--virtual-time-budget=10000', source.as_uri(),
        ],
        check=True,
        capture_output=True,
    )
    print(f'wrote {target.relative_to(ROOT)} ({target.stat().st_size // 1024} KB)')


def main() -> int:
    body = render(SOURCE.read_text())
    page = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<title>VO Capture &amp; Control — Full Test Plan</title>'
        f'<style>{CSS}</style></head><body>{COVER}{body}</body></html>'
    )
    HTML_OUT.write_text(page)
    print(f'wrote {HTML_OUT.relative_to(ROOT)}')

    chrome = next((c for c in CHROME_CANDIDATES if Path(c).exists()), None) or shutil.which('chromium')
    if not chrome:
        print('No Chrome found — the HTML is written; print it to PDF by hand.')
        return 1

    to_pdf(chrome, HTML_OUT, PDF_OUT)

    if AR_HTML.exists():
        to_pdf(chrome, AR_HTML, AR_PDF)

    return 0


if __name__ == '__main__':
    sys.exit(main())
