#!/usr/bin/env python3
"""
Unit tests for database models (simplified version)
"""

import sys
import os

# Ensure we can import from backend
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend', 'app'))

def test_candidate_model():
    """Test that candidate model works"""
    print("Testing Candidate model...")
    
    # Import here to avoid circular reference issues 
    from models.candidate import Candidate
    
    # Create a sample candidate
    candidate = Candidate(
        name="John Doe",
        email="john@example.com",
        phone="123-456-7890"
    )
    
    assert candidate.name == "John Doe"
    assert candidate.email == "john@example.com" 
    assert candidate.phone == "123-456-7890"
    
    print("  OK: Candidate model works correctly")
    return True

def test_job_model():
    """Test that job model works"""
    print("Testing Job model...")
    
    from models.job import Job  
    
    # Create a sample job
    job = Job(
        title="Software Engineer",
        company="Tech Corp",
        description="Develop software applications",
        location="San Francisco, CA"
    )
    
    assert job.title == "Software Engineer"
    assert job.company == "Tech Corp"
    assert job.description == "Develop software applications"
    assert job.location == "San Francisco, CA"
    
    print("  OK: Job model works correctly")
    return True

def test_application_model():
    """Test that application model works"""
    print("Testing Application model...")
    
    from models.application import Application

    # Create a sample application  
    application = Application(
        job_id=1,
        candidate_id=1,
        status="discovered"
    )
    
    assert application.job_id == 1
    assert application.candidate_id == 1
    assert application.status == "discovered"
    
    print("  OK: Application model works correctly")
    return True

def run_all_tests():
    """Run all model tests"""
    tests = [
        test_candidate_model,
        test_job_model, 
        test_application_model
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