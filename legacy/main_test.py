#!/usr/bin/env python3
"""
Simple script to verify we can create tables and run basic operations
"""
import sys
import os

# Add the backend app to path 
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend', 'app'))

def test_basic_imports():
    """Test basic imports work"""
    try:
        from db import engine, Base
        from models.candidate import Candidate  
        from models.job import Job
        from models.application import Application
        
        print("SUCCESS: All imports successful")
        
        # Try to initialize tables properly without relative import issues
        Base.metadata.create_all(bind=engine)
        print("SUCCESS: Tables created successfully")
        
        return True
    except Exception as e:
        print(f"ERROR: Import test failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_basic_imports()
    sys.exit(0 if success else 1)