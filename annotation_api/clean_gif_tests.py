#!/usr/bin/env python3
"""
Script to remove all GIF-related test functions and field references from test files.
This is a cleanup script for the GIF system removal.
"""

import re
from pathlib import Path

def remove_gif_test_functions(file_path: Path) -> bool:
    """Remove GIF-related test functions from the file."""
    if not file_path.exists():
        print(f"File {file_path} does not exist")
        return False
    
    content = file_path.read_text()
    original_content = content
    
    # GIF test function patterns to remove completely
    gif_functions = [
        "test_generate_sequence_annotation_gifs_success",
        "test_generate_sequence_annotation_gifs_url_preservation", 
        "test_get_sequence_annotation_gif_urls",
        "test_get_sequence_annotation_gif_urls_not_found",
        "test_generate_sequence_annotation_gifs_annotation_not_found",
        "test_generate_sequence_annotation_gifs_no_bboxes",
        "test_generate_sequence_annotation_gifs_missing_images_from_s3"
    ]
    
    for func_name in gif_functions:
        # Pattern to match the entire function including @pytest.mark.asyncio decorator
        pattern = rf"@pytest\.mark\.asyncio\s*\n\s*async def {func_name}\([^:]*?\):[^@]*?(?=(?:@pytest\.mark\.asyncio\s*\n\s*async def|\nclass|\Z))"
        content = re.sub(pattern, "", content, flags=re.DOTALL | re.MULTILINE)
    
    # Remove empty lines that result from function removal (more than 2 consecutive empty lines)
    content = re.sub(r'\n\s*\n\s*\n+', '\n\n', content)
    
    if content != original_content:
        file_path.write_text(content)
        print(f"Removed GIF test functions from {file_path}")
        return True
    else:
        print(f"No GIF test functions found in {file_path}")
        return False

def remove_gif_fields(file_path: Path) -> bool:
    """Remove GIF field references from test data structures."""
    if not file_path.exists():
        print(f"File {file_path} does not exist")
        return False
    
    content = file_path.read_text()
    original_content = content
    
    # Remove gif field lines (including trailing commas)
    gif_field_patterns = [
        r'^\s*["\']?gif_key_main["\']?\s*:\s*[^,\n]+,?\s*\n',
        r'^\s*["\']?gif_key_crop["\']?\s*:\s*[^,\n]+,?\s*\n',
        r'^\s*["\']?gif_url_main["\']?\s*:\s*[^,\n]+,?\s*\n',
        r'^\s*["\']?gif_url_crop["\']?\s*:\s*[^,\n]+,?\s*\n',
    ]
    
    for pattern in gif_field_patterns:
        content = re.sub(pattern, "", content, flags=re.MULTILINE)
    
    # Clean up any trailing commas that might be left behind
    content = re.sub(r',(\s*[}\]])', r'\1', content)
    
    if content != original_content:
        file_path.write_text(content)
        print(f"Removed GIF field references from {file_path}")
        return True
    else:
        print(f"No GIF field references found in {file_path}")
        return False

def main():
    """Clean up GIF references from test files."""
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
            
            # Remove test functions
            functions_removed = remove_gif_test_functions(full_path)
            
            # Remove field references  
            fields_removed = remove_gif_fields(full_path)
            
            if functions_removed or fields_removed:
                modified_files.append(file_path)
        else:
            print(f"Skipping {file_path} - file not found")
    
    print(f"\n=== GIF Cleanup Complete ===")
    print(f"Modified {len(modified_files)} files:")
    for file in modified_files:
        print(f"  - {file}")
    
    if not modified_files:
        print("No files were modified - cleanup may already be complete")

if __name__ == "__main__":
    main()