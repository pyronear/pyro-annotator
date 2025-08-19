#!/usr/bin/env python3
"""
Final cleanup of all remaining GIF test fragments.
"""

from pathlib import Path
import re

def clean_test_file(file_path: Path) -> bool:
    """Remove all remaining GIF references from test files."""
    if not file_path.exists():
        return False
    
    content = file_path.read_text()
    original_content = content
    
    # Remove specific GIF test patterns
    patterns = [
        # Remove gif_key field references in test assertions  
        r'^\s*assert.*?gif_key.*?\n',
        r'^\s*gif_key_[^=]*=.*?\n',
        r'^\s*assert.*?gif_urls.*?\n',
        r'^\s*gif_urls\s*=.*?\n',
        # Remove GIF URL test fragments
        r'^\s*assert.*?"gifs/sequence.*?\n',
        r'^\s*bbox_urls\s*=.*?\n',
        # Remove GIF-related variable assignments
        r'^\s*assert.*?bbox_urls.*?\n',
    ]
    
    for pattern in patterns:
        old_content = content
        content = re.sub(pattern, "", content, flags=re.MULTILINE)
        if content != old_content:
            print(f"  Removed GIF pattern from {file_path.name}")
    
    # Also remove any remaining test function fragments that are incomplete
    # Remove any function that still has generate_sequence_annotation_gifs in the name
    gif_func_pattern = r'@pytest\.mark\.asyncio\s*\n\s*async def test_.*?gif.*?\(.*?\):[^@]*?(?=(?:@pytest\.mark\.asyncio\s*\n\s*async def|class\s+|\Z))'
    if re.search(gif_func_pattern, content, re.DOTALL | re.IGNORECASE):
        print(f"  Removing remaining GIF function fragments from {file_path.name}")
        content = re.sub(gif_func_pattern, "", content, flags=re.DOTALL | re.IGNORECASE | re.MULTILINE)
    
    # Clean up empty lines and broken syntax
    content = re.sub(r'\n\s*\n\s*\n+', '\n\n', content)
    content = re.sub(r'^\s*\):\s*\n', '', content, flags=re.MULTILINE)
    content = re.sub(r'^\s*\)\s*\n', '', content, flags=re.MULTILINE)
    
    if content != original_content:
        file_path.write_text(content)
        return True
    return False

def main():
    """Clean up all remaining GIF test references."""
    test_files = [
        "src/tests/endpoints/test_sequence_annotations.py",
        "src/tests/schemas/test_annotation_validation.py",
    ]
    
    base_path = Path(".")
    modified_files = []
    
    for file_path in test_files:
        full_path = base_path / file_path
        if full_path.exists():
            print(f"Processing {file_path}...")
            if clean_test_file(full_path):
                modified_files.append(file_path)
                print(f"  ✅ Cleaned {file_path}")
            else:
                print(f"  ℹ️ No changes needed in {file_path}")
    
    print(f"\n=== Final Test Cleanup Results ===")
    if modified_files:
        print(f"Modified {len(modified_files)} files:")
        for file in modified_files:
            print(f"  - {file}")
    else:
        print("No test files were modified")

if __name__ == "__main__":
    main()