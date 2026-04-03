#!/bin/bash
# Regenerate dashboard.h from dashboard.html
# Run this after editing dashboard.html

set -e
cd "$(dirname "$0")"

echo "Compressing dashboard.html..."
gzip -c -9 dashboard.html > dashboard.html.gz
ORIG=$(wc -c < dashboard.html | tr -d ' ')
GZIP=$(wc -c < dashboard.html.gz | tr -d ' ')

echo "Generating dashboard.h..."
python3 -c "
data = open('dashboard.html.gz','rb').read()
out = ['/*', ' * Auto-generated from dashboard.html', ' * Size: %d bytes (gzipped from $ORIG)' % len(data), ' * Regenerate: ./gen_dashboard.sh', ' */', '', '#ifndef DPA_DASHBOARD_H', '#define DPA_DASHBOARD_H', '', '#include <pgmspace.h>', '', 'const size_t DASHBOARD_HTML_GZ_LEN = %d;' % len(data), '', 'const uint8_t DASHBOARD_HTML_GZ[] PROGMEM = {']
line = '  '
for i, b in enumerate(data):
    line += '0x%02x' % b
    if i < len(data)-1:
        line += ','
    if len(line) > 100:
        out.append(line)
        line = '  '
if line.strip():
    out.append(line)
out.append('};')
out.append('')
out.append('#endif // DPA_DASHBOARD_H')
open('dashboard.h','w').write('\n'.join(out))
"

rm dashboard.html.gz
echo "Done! $ORIG → $GZIP bytes ($(( 100 - GZIP * 100 / ORIG ))% smaller)"
