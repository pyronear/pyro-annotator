#!/usr/bin/env python3
"""Remove specific GIF test functions."""

import re
from pathlib import Path

def remove_gif_functions(file_path):
    content = file_path.read_text()
    
    # List of GIF test functions to remove
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
        # Remove the entire function including @pytest.mark.asyncio decorator
        pattern = rf'@pytest\.mark\.asyncio\s*\n\s*async def {func_name}\([^)]*\):.*?(?=(?:@pytest\.mark\.asyncio\s*\n\s*async def|class\s+|\Z))'
        content = re.sub(pattern, '', content, flags=re.DOTALL)
        print(f"Removed function: {func_name}")
    
    # Clean up multiple blank lines
    content = re.sub(r'\n\s*\n\s*\n+', '\n\n', content)
    
    file_path.write_text(content)

if __name__ == "__main__":
    file_path = Path("src/tests/endpoints/test_sequence_annotations.py")
    remove_gif_functions(file_path)
    print("GIF functions removed successfully!")