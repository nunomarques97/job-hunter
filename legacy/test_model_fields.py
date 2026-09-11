#!/usr/bin/env python3
"""
Unit tests for database models - simplified version
"""

import sys
import os

# Ensure we can import from backend
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend', 'app'))

def test_candidate_model_fields():
    """Test that candidate model fields match expected structure"""
    print("Testing Candidate model fields...")
    
    # Import here to avoid circular reference issues 
    from models.candidate import Candidate
    
    # Check the class attributes are accessible (no need to instantiate)
    assert hasattr(Candidate, 'id')
    assert hasattr(Candidate, 'name')
    assert hasattr(Candidate, 'headline') 
    assert hasattr(Candidate, 'summary')
    assert hasattr(Candidate, 'current_role')
    assert hasattr(Candidate, 'years_of_experience')
    assert hasattr(Candidate, 'location')
    
    print("  OK: Candidate model fields are correct")
    return True

def test_job_model_fields():
    """Test that job model fields match expected structure"""
    print("Testing Job model fields...")
    
    from models.job import Job  
    
    # Check the class attributes are accessible (no need to instantiate)
    assert hasattr(Job, 'id')
    assert hasattr(Job, 'title')
    assert hasattr(Job, 'company')
    assert hasattr(Job, 'description') 
    assert hasattr(Job, 'location')
    assert hasattr(Job, 'salary')
    
    print("  OK: Job model fields are correct")
    return True

def test_application_model_fields():
    """Test that application model fields match expected structure"""
    print("Testing Application model fields...")
    
    from models.application import Application

    # Check the class attributes are accessible (no need to instantiate)
    assert hasattr(Application, 'id')
    assert hasattr(Application, 'job_id')
    assert hasattr(Application, 'candidate_id') 
    assert hasattr(Application, 'status')
    
    print("  OK: Application model fields are correct")
    return True

def run_all_tests():
    """Run all model tests"""
    tests = [
        test_candidate_model_fields,
        test_job_model_fields, 
        test_application_model_fields
    ]
    
    results = []
    for i, test in enumerate(tests):
        try:
            result = test()
            results.append(result)
        except Exception as e:
            print(f"  FAILED: Test {test.__name__} failed: {e}")
            import traceback
            traceback.print_exc()
            results.append(False)
            
    return all(results)

if __name__ == "__main__":
    print("Running database model tests...")
    success = run_all_tests()
    if success:
        print("\nSUCCESS: All model tests passed!")
    else:
        print("\nFAILURE: Some tests failed!")
    sys.exit(0 if success else 1)