import json

log_path = r'C:\Users\Oppen\.gemini\antigravity\brain\5c6bae41-30cd-4625-8413-2d68d740af18\.system_generated\logs\overview.txt'
with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        if '"step_index":307' in line:
            data = json.loads(line)
            content = data['content']
            with open('apps/mobile/app/user_diff.txt', 'w', encoding='utf-8') as out:
                out.write(content)
            print(f'Wrote {len(content)} characters to user_diff.txt')
            break
