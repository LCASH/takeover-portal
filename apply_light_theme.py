import re

with open('/Users/lukecashman/Documents/takeover-portal/styles.css', 'r') as f:
    css = f.read()

replacements = {
    # Background and surfaces
    r'background-color: #09090b;': 'background-color: #ffffff;',
    r'background-color: #18181b;': 'background-color: #f8fafc;',
    r'background: #0a0a0b;': 'background: #f1f5f9;',
    
    # Texts
    r'color: #f4f4f5;': 'color: #0f172a;',
    r'color: #e4e4e7;': 'color: #334155;',
    r'color: #a1a1aa;': 'color: #64748b;',
    r'color: #71717a;': 'color: #94a3b8;',
    r'color: #52525b;': 'color: #94a3b8;',
    
    # Borders
    r'border: 1px solid #27272a;': 'border: 1px solid #e2e8f0;',
    r'border-bottom: 1px solid #27272a;': 'border-bottom: 1px solid #e2e8f0;',
    r'border-top: 1px solid #27272a;': 'border-top: 1px solid #e2e8f0;',
    r'border-bottom: 2px solid #3f3f46;': 'border-bottom: 2px solid #cbd5e1;',
    r'border-color: #3f3f46;': 'border-color: #94a3b8;',
    r'border: 1px solid rgba\(255, 255, 255, 0\.1\);': 'border: 1px solid rgba(0, 0, 0, 0.1);',
    r'border: 2px solid #27272a;': 'border: 2px solid #e2e8f0;',
    
    # Eye specific
    r'background: linear-gradient\(135deg, #18181b 0%, #09090b 100%\);': 'background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);',
    r'box-shadow: 0 4px 20px rgba\(0, 0, 0, 0\.5\), inset 0 0 0 1px rgba\(255, 255, 255, 0\.05\);': 'box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05), inset 0 0 0 1px rgba(0, 0, 0, 0.05);',
    r'background: #09090b;': 'background: #ffffff;',
    r'box-shadow: 0 25px 50px -12px rgba\(0, 0, 0, 0\.75\);': 'box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.1);',
}

for old, new in replacements.items():
    css = re.sub(old, new, css)

with open('/Users/lukecashman/Documents/takeover-portal/styles.css', 'w') as f:
    f.write(css)

print("Applied light theme replacements!")
