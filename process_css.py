import re

with open('recovered_mobile.css', 'r', encoding='utf-8') as f:
    css = f.read()

# 1. Strip the :root block and basic resets that are handled by web globals
# We can just remove everything up to the first actual mobile class, or we can just replace the variables.
# Actually, since we'll import web CSS, let's just keep the file but remove the `:root` variables to avoid confusion.
css = re.sub(r':root\s*\{[^}]*\}', '', css)

# 2. Replace variables
replacements = {
    'var(--mobile-bg)': 'var(--bg)',
    'var(--mobile-panel)': 'var(--panel)',
    'var(--mobile-ink)': 'var(--text)',
    'var(--mobile-muted)': 'var(--muted)',
    'var(--mobile-line)': 'var(--line)',
    'var(--mobile-accent)': 'var(--accent)',
    'var(--mobile-accent-strong)': 'var(--accent)',
    'var(--mobile-warn)': '#b42318' # hardcode if warn missing
}

for old, new in replacements.items():
    css = css.replace(old, new)

# 3. Add import
final_css = "@import '../../web/app/globals.css';\n\n" + css

with open('apps/mobile/app/globals.css', 'w', encoding='utf-8') as out:
    out.write(final_css)

print('Generated new globals.css with length', len(final_css))
