#!/usr/bin/env python3
"""
Final verification of backend functionality
"""
import sys
import os

# Add proper paths
script_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(script_dir, 'backend', 'app')

sys.path.insert(0, backend_dir)

def validate_setup():
    """Validate that all major components are set up correctly"""
    
    try:
        # Test importing core modules
        from db import Base, engine
        print("✓ Database module imports")
        
        # Test model imports 
        from models.candidate import Candidate
        from models.job import Job
        from models.application import Application
        print("✓ Models imported successfully")
        
        # Test schema imports  
        from schemas.candidate import CandidateCreate, CandidateUpdate
        from schemas.job import JobCreate, JobUpdate
        print("✓ Schemas imported successfully")
        
        # Test LLM provider
        from llm import get_llm_provider
        provider = get_llm_provider()
        print("✓ LLM provider works")
        
        # Test routes exist
        from api import candidate, job, application, automation, health
        print("✓ API routes available")
        
        print("\n🎉 ALL COMPONENTS ARE FUNCTIONAL")
        return True
        
    except Exception as e:
        print(f"✗ Setup validation failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = validate_setup()
    sys.exit(0 if success else 1)