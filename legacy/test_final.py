#!/usr/bin/env python3
"""
Final verification script - no Unicode characters
"""

import sys
import os

# Add project root to Python path  
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(project_root, 'backend', 'app'))

def test_backend_ready():
    """Basic check that the app can be imported and functions"""
    
    print("Testing basic backend functionality...")
    
    # Test that we can import key modules  
    try:
        from models.candidate import Candidate
        from models.job import Job
        from models.application import Application
        print("  OK: Models imported")
        
        from schemas.candidate import CandidateCreate, CandidateUpdate
        from schemas.job import JobCreate, JobUpdate
        from schemas.application import ApplicationCreate, ApplicationUpdate
        print("  OK: Schemas imported")
        
        from llm import get_llm_provider
        print("  OK: LLM provider accessible")
        
        # Try to get a provider instance 
        provider = get_llm_provider()
        model_info = provider.get_model_info()
        print("  OK: LLM provider operational")
        print("    Model name:", model_info['name'])
        
        from db import engine, Base
        print("  OK: Database modules accessible")
        
        print("\nSUCCESS: All core backend components working!")
        return True
        
    except Exception as e:
        print("  ERROR: Backend test failed:", e)
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_backend_ready()
    sys.exit(0 if success else 1)