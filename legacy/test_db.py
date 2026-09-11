#!/usr/bin/env python3
"""
Test script to verify that database initialization and models work properly.
"""
import sys
import os
import tempfile

# Add the backend app to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend', 'app'))

def test_db_init():
    """Test that DB initialization works correctly"""
    try:
        from db import init_db
        from db import engine
        
        # Initialize the database - this should not raise exceptions
        init_db()
        
        print("✓ Database initialized successfully")
        return True
        
    except Exception as e:
        print(f"✗ Database initialization failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_models_import():
    """Test that all models can be imported"""
    try:
        from models.candidate import Candidate
        from models.job import Job
        from models.application import Application
        from models.job_score import JobScore
        from models.email_message import EmailMessage
        from models.automation_run import AutomationRun
        from models.activity_log import ActivityLog
        
        print("✓ All models imported successfully")
        return True
        
    except Exception as e:
        print(f"✗ Model import failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_schema_import():
    """Test that all schemas can be imported"""
    try:
        from schemas.candidate import CandidateCreate, CandidateUpdate
        from schemas.job import JobCreate, JobUpdate
        from schemas.application import ApplicationCreate, ApplicationUpdate
        
        print("✓ All schemas imported successfully")
        return True
        
    except Exception as e:
        print(f"✗ Schema import failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    tests = [
        test_db_init,
        test_models_import, 
        test_schema_import
    ]
    
    results = []
    for test in tests:
        print(f"\nRunning {test.__name__}...")
        results.append(test())
        
    passed = sum(results)
    total = len(results)
    
    if passed == total:
        print(f"\n🎉 ALL TESTS PASSED ({passed}/{total})")
        sys.exit(0)
    else:
        print(f"\n❌ SOME TESTS FAILED ({passed}/{total})")
        sys.exit(1)