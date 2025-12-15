#!/usr/bin/env python3
"""
Script to add error logging to all exception handlers in Telegrambot_change.py
"""
import re

def add_logging_to_exceptions():
    file_path = "Telegrambot_change.py"
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Pattern to find exception handlers without logging
    # This looks for: except Exception as e: followed by anything except log_error_to_file
    pattern = r'(    except Exception as \w+:)\n((?!.*log_error_to_file).*?\n(?:        .*\n)*?)'
    
    def get_function_name(text, pos):
        """Extract function name before the exception"""
        lines_before = text[:pos].split('\n')
        for line in reversed(lines_before[-50:]):  # Look at last 50 lines
            if line.strip().startswith('async def ') or line.strip().startswith('def '):
                match = re.match(r'\s*(async\s+)?def\s+(\w+)', line)
                if match:
                    return match.group(2)
        return "unknown_function"
    
    matches = list(re.finditer(pattern, content, re.MULTILINE))
    
    print(f"Found {len(matches)} exception handlers that might need logging")
    
    # Process in reverse to maintain positions
    for match in reversed(matches):
        func_name = get_function_name(content, match.start())
        exception_line = match.group(1)
        following_code = match.group(2)
        
        # Check if it already has any kind of error logging
        if 'log_error_to_file' in following_code or 'logger.error' in following_code:
            continue
            
        # Add the logging call
        indent = "        "
        logging_line = (
            f"{indent}log_error_to_file(e, \"{func_name}\", \n"
            f"{indent}                 update.effective_user.id if update and update.effective_user else None, update)\n"
        )
        
        new_text = f"{exception_line}\n{logging_line}{following_code}"
        content = content[:match.start()] + new_text + content[match.end():]
    
    # Write back
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"✅ Added error logging to exception handlers")

if __name__ == '__main__':
    add_logging_to_exceptions()
