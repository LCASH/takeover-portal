import re

files = [
    '/Users/lukecashman/Documents/takeover-portal/login.html',
    '/Users/lukecashman/Documents/takeover-portal/portal.html',
    '/Users/lukecashman/Documents/takeover-portal/account.html'
]

html_replacements = {
    # Tailwind text colours
    r'text-white': 'text-slate-900',
    r'text-zinc-500': 'text-slate-500',
    r'text-zinc-400': 'text-slate-600',
    r'text-zinc-300': 'text-slate-700',
    r'text-emerald-400': 'text-emerald-600',
    r'text-blue-400': 'text-blue-600',
    r'hover:text-blue-400': 'hover:text-blue-600',
    r'placeholder-zinc-600': 'placeholder-slate-400',
    
    # Tailwind borders
    r'border-zinc-800': 'border-slate-200',
    r'border-zinc-700': 'border-slate-300',
    
    # Tailwind backgrounds
    r'bg-zinc-900': 'bg-white',
    r'bg-black/50': 'bg-slate-100/50',
    r'bg-black/40': 'bg-slate-100/50',
    r'bg-zinc-800': 'bg-slate-100',
    r'rounded-lg text-white': 'rounded-lg text-slate-900',

    # Inline CSS variable adjustments (in <style> block of these HTML files)
    r'--bg-dark: #09090b;': '--bg-dark: #ffffff;',
    r'--surface: #18181b;': '--surface: #ffffff;',
    r'color: white;': 'color: #0f172a;',
    r'border: 1px solid #27272a;': 'border: 1px solid #e2e8f0;',
    r'color: #a1a1aa;': 'color: #64748b;',
    r'border-color: #3f3f46;': 'border-color: #94a3b8;',
    r'border: 2px dashed #27272a;': 'border: 2px dashed #e2e8f0;',
    r'background: rgba\(24, 24, 27, 0\.5\);': 'background: rgba(248, 250, 252, 0.5);',
    r'background: #18181b;': 'background: #ffffff;',
}

for path in files:
    with open(path, 'r') as f:
        content = f.read()
    
    for old, new in html_replacements.items():
        content = re.sub(old, new, content)
        
    with open(path, 'w') as f:
        f.write(content)

print("Applied HTML replacements!")
