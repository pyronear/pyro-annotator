#!/usr/bin/env python3
"""
Final manual GIF cleanup script - removes specific remaining GIF test functions.
"""

from pathlib import Path
import re

def remove_specific_gif_functions(file_path: Path) -> bool:
    """Remove specific GIF test functions by name."""
    if not file_path.exists():
        return False
    
    content = file_path.read_text()
    original_content = content
    
    # List of GIF test functions to remove completely
    gif_functions_to_remove = [
        "test_generate_sequence_annotation_gifs_success",
        "test_generate_sequence_annotation_gifs_url_preservation", 
        "test_generate_sequence_annotation_gifs_annotation_not_found",
        "test_generate_sequence_annotation_gifs_no_bboxes",
        "test_generate_sequence_annotation_gifs_missing_images_from_s3",
    ]
    
    for func_name in gif_functions_to_remove:
        print(f"  Looking for function: {func_name}")
        
        # Pattern to match the entire function including decorator and everything until next function
        # This matches: @pytest.mark.asyncio + async def function_name + all content until next @pytest.mark.asyncio
        pattern = rf'@pytest\.mark\.asyncio\s*\n\s*async def {re.escape(func_name)}\([^)]*\):[^@]*?(?=(?:@pytest\.mark\.asyncio\s*\n\s*async def|class\s+|\Z))'
        
        matches = re.findall(pattern, content, re.DOTALL | re.MULTILINE)
        if matches:
            print(f"    Found and removing {func_name}")
            content = re.sub(pattern, "", content, flags=re.DOTALL | re.MULTILINE)
        else:
            print(f"    {func_name} not found or already removed")
    
    # Also remove any orphaned fragments that mention GIF endpoints
    gif_fragment_patterns = [
        r'^\s*""".*?GIF.*?""".*?\n',  # GIF-related docstrings
        r'^\s*#.*?GIF.*?\n',  # GIF-related comments
    ]
    
    for pattern in gif_fragment_patterns:
        content = re.sub(pattern, "", content, flags=re.MULTILINE | re.IGNORECASE)
    
    # Clean up multiple blank lines and orphaned decorators
    content = re.sub(r'\n\s*\n\s*\n+', '\n\n', content)
    content = re.sub(r'@pytest\.mark\.asyncio\s*\n\s*@pytest\.mark\.asyncio', '@pytest.mark.asyncio', content)
    
    # Remove any lines that are just calling GIF endpoints (orphaned fragments)
    lines = content.split('\n')
    cleaned_lines = []
    skip_next = False
    
    for i, line in enumerate(lines):
        if skip_next:
            skip_next = False
            continue
            
        # Skip lines that contain GIF endpoint calls but are not inside a non-GIF function
        if ('generate-gifs' in line or 
            'gif_resp' in line or 
            'gif_result' in line or 
            '/gifs/urls' in line or
            'gif_count' in line or
            'gif_keys' in line):
            
            # Check if this is inside a function that we want to keep
            # Look backwards to find the current function
            current_func_name = None
            for j in range(i-1, max(0, i-50), -1):
                if 'async def test_' in lines[j]:
                    func_match = re.search(r'async def (test_\w+)', lines[j])
                    if func_match:
                        current_func_name = func_match.group(1)
                        break
            
            if current_func_name and current_func_name not in gif_functions_to_remove:
                # This is inside a non-GIF function, keep it
                cleaned_lines.append(line)
            else:
                # This is a GIF-related fragment, skip it
                print(f"    Removing GIF fragment: {line.strip()[:50]}...")
                continue
        else:
            cleaned_lines.append(line)
    
    content = '\n'.join(cleaned_lines)
    
    # Final cleanup
    content = re.sub(r'\n\s*\n\s*\n+', '\n\n', content)
    
    if content != original_content:
        file_path.write_text(content)
        return True
    return False

def main():
    """Final GIF cleanup."""
    file_path = Path("src/tests/endpoints/test_sequence_annotations.py")
    
    if not file_path.exists():
        print(f"File {file_path} not found")
        return
    
    print(f"Processing {file_path}...")
    
    if remove_specific_gif_functions(file_path):
        print(f"✅ Successfully cleaned up {file_path}")
    else:
        print(f"ℹ️  No changes needed in {file_path}")
    
    # Verify cleanup
    remaining_gif_refs = 0
    with open(file_path, 'r') as f:
        content = f.read()
        gif_patterns = ['generate-gifs', 'gif_resp', 'gif_result', '/gifs/urls']
        for pattern in gif_patterns:
            remaining_gif_refs += content.lower().count(pattern.lower())
    
    print(f"\nRemaining GIF references: {remaining_gif_refs}")
    if remaining_gif_refs == 0:
        print("🎉 All GIF references successfully removed!")
    else:
        print("⚠️  Some GIF references may still remain")

if __name__ == "__main__":
    main()