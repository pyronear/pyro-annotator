#!/usr/bin/env python3
"""
Complete GIF test cleanup script - removes all remaining GIF test function bodies.
This removes functions that still test GIF endpoints even after field cleanup.
"""

import re
from pathlib import Path
import ast

def find_and_remove_gif_functions(file_path: Path) -> bool:
    """Find and completely remove any test functions that contain GIF-related code."""
    if not file_path.exists():
        return False
    
    content = file_path.read_text()
    original_content = content
    
    # Split into lines for easier processing
    lines = content.split('\n')
    new_lines = []
    in_function = False
    current_function_name = None
    function_lines = []
    function_indent = 0
    
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Check if we're starting a new function
        if re.match(r'^async def test_.*?\(', line.strip()) and not in_function:
            # Extract function name
            match = re.match(r'^async def (test_.*?)\(', line.strip())
            if match:
                current_function_name = match.group(1)
                function_lines = [line]
                function_indent = len(line) - len(line.lstrip())
                in_function = True
                i += 1
                continue
        
        # If we're in a function, collect its lines
        elif in_function:
            # Check if this line ends the function (next function or class, or end of file)
            line_indent = len(line) - len(line.lstrip()) if line.strip() else float('inf')
            
            if (line.strip().startswith('@pytest.mark.asyncio') or 
                line.strip().startswith('async def test_') or 
                line.strip().startswith('class ') or
                (line.strip() and line_indent <= function_indent and line.strip() != '')):
                # Function ended, check if it contains GIF code
                function_content = '\n'.join(function_lines)
                
                gif_patterns = [
                    'generate-gifs',
                    'gif_resp',
                    'gif_result', 
                    '/gifs/urls',
                    'gif_count',
                    'gif_keys',
                    'gif_url'
                ]
                
                contains_gif = any(pattern in function_content for pattern in gif_patterns)
                
                if not contains_gif:
                    # Keep this function
                    new_lines.extend(function_lines)
                else:
                    print(f"  Removing GIF function: {current_function_name}")
                
                # Reset function state
                in_function = False
                current_function_name = None
                function_lines = []
                function_indent = 0
                
                # Don't increment i, process this line in the next iteration
                continue
            else:
                # Still in function
                function_lines.append(line)
                i += 1
                continue
        
        # Not in a function, keep the line
        new_lines.append(line)
        i += 1
    
    # Handle case where file ends while in a function
    if in_function and function_lines:
        function_content = '\n'.join(function_lines)
        gif_patterns = [
            'generate-gifs',
            'gif_resp', 
            'gif_result',
            '/gifs/urls',
            'gif_count',
            'gif_keys',
            'gif_url'
        ]
        
        contains_gif = any(pattern in function_content for pattern in gif_patterns)
        
        if not contains_gif:
            new_lines.extend(function_lines)
        else:
            print(f"  Removing GIF function: {current_function_name}")
    
    new_content = '\n'.join(new_lines)
    
    # Clean up multiple blank lines
    new_content = re.sub(r'\n\s*\n\s*\n+', '\n\n', new_content)
    
    if new_content != original_content:
        file_path.write_text(new_content)
        return True
    return False

def main():
    """Complete GIF cleanup from test files."""
    test_files = [
        "src/tests/endpoints/test_sequence_annotations.py",
        "src/tests/endpoints/test_sequence.py", 
        "src/tests/endpoints/test_detection_annotation_workflow.py",
        "src/tests/schemas/test_annotation_validation.py",
        "src/tests/clients/test_annotation_api.py"
    ]
    
    base_path = Path(".")
    modified_files = []
    
    for file_path in test_files:
        full_path = base_path / file_path
        if full_path.exists():
            print(f"\nProcessing {file_path}...")
            
            if find_and_remove_gif_functions(full_path):
                modified_files.append(file_path)
                print(f"  Modified {file_path}")
            else:
                print(f"  No changes needed in {file_path}")
        else:
            print(f"Skipping {file_path} - file not found")
    
    print(f"\n=== Complete GIF Cleanup Results ===")
    print(f"Modified {len(modified_files)} files:")
    for file in modified_files:
        print(f"  - {file}")
    
    if not modified_files:
        print("No files were modified - cleanup may already be complete")

if __name__ == "__main__":
    main()