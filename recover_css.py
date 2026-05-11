import re, json
path = r'apps/mobile/.next/cache/webpack/client-production/22.pack'
with open(path, 'rb') as f:
    data = f.read().decode('utf-8', errors='ignore')

idx = data.find('.mobile-pdf-text-layer')
if idx != -1:
    start = data.rfind(':root', 0, idx)
    if start == -1: start = data.rfind('body {', 0, idx)
    if start != -1:
        end = data.find('.mobile-viewer-mobile .mobile-workspace-pane', idx)
        if end != -1:
            end = data.find('}', end) + 1
            css_raw = data[start:end]
            css = css_raw.replace('\\n', '\n').replace('\\\"', '\"')
            with open('recovered_mobile.css', 'w', encoding='utf-8') as out:
                out.write(css)
            print('Recovered CSS length:', len(css))
        else: print('End not found')
    else: print('Start not found')
else: print('Not found in 22.pack')
