#!/usr/bin/env python3
"""
Simple test of imports to verify our setup works
"""
import sys
import os

# Add the backend app to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend', 'app'))

def test_imports():
    """Test basic imports work"""
    try:
        # Test that we can import all major modules
        import main
        
        from cv.generator import CVGenerator
        from scoring.service import JobScoringService
        from automation.service import automation_engine
        from models.candidate import Candidate
        from models.job import Job
        from models.application import Application
        
        print("SUCCESS: All imports successful")
        
        # Test database works
        import db
        print("SUCCESS: Database module available")
        
        # Test that the structure looks correct  
        if hasattr(db, 'init_db'):
            print("SUCCESS: DB initialization function found")
            
        return True
        
    except Exception as e:
        print(f"ERROR: Import test failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_imports()
    if success:
        print("\nALL TESTS PASSED")
    else:
        print("\nTESTS FAILED")
    sys.exit(0 if success else 1)