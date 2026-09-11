#!/usr/bin/env python3
"""
Final simple test of project structure
"""

import os
import sys

def test_project_structure():
    """Test that key project directories and files exist"""
    try:
        # Test core directories exist
        required_dirs = [
            'backend/app',
            'backend/app/models', 
            'backend/app/api',
            'backend/app/cv',
            'backend/app/scoring',
            'backend/app/automation',
            'backend/app/sources'
        ]
        
        for dir_path in required_dirs:
            if not os.path.exists(dir_path):
                print(f"ERROR: Missing directory: {dir_path}")
                return False
            else:
                print(f"OK: Directory exists: {dir_path}")
        
        # Test core files exist
        core_files = [
            'backend/app/main.py',
            'backend/app/db/__init__.py',
            'backend/app/models/candidate.py',
            'backend/app/models/job.py',
            'backend/app/models/application.py'
        ]
        
        for file_path in core_files:
            if not os.path.exists(file_path):
                print(f"ERROR: Missing file: {file_path}")
                return False
            else:
                print(f"OK: File exists: {file_path}")
                
        # Test basic file content to make sure it's not empty
        with open('backend/app/main.py', 'r') as f:
            content = f.read()
            
        if len(content) > 100:  # Make sure file has reasonable content
            print("OK: Main application file has proper content")
        else:
            print("ERROR: Main application file seems to be empty or corrupt")
            return False
            
        print("\nSUCCESS: Project structure test passed")
        return True
        
    except Exception as e:
        print(f"ERROR: Project structure test failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_project_structure()
    sys.exit(0 if success else 1)