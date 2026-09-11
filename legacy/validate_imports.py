#!/usr/bin/env python3
"""
Test script to validate all modules import properly (basic validation)
"""
import sys

# Make sure we have access to all modules
try:
    # Test basic imports
    import backend.app.main as main_module
    from backend.app.db import init_db
    print("SUCCESS: Basic imports successful")
    
    # Test initialization
    init_db()
    print("SUCCESS: Database initialized")
    
    print("\nSUCCESS: All validation tests passed!")
except Exception as e:
    print(f"ERROR: Validation failed: {str(e)}")
    import traceback
    traceback.print_exc()
    sys.exit(1)