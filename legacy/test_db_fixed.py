#!/usr/bin/env python3
"""
Test script to validate database setup and basic functionality
"""
import sys
import os

# Add the backend app to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend', 'app'))

from db import init_db, engine
from sqlalchemy.orm import sessionmaker
from models.candidate import Candidate
from models.job import Job
from models.application import Application

def test_db_setup():
    """Test that our database setup works"""
    try:
        # Initialize the database
        init_db()
        
        # Test connection
        conn = engine.connect()
        print("SUCCESS: Database connection successful")
        conn.close()
        
        # Test creating a candidate record
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = SessionLocal()
        
        candidate = Candidate(
            name="John Doe",
            headline="Senior Software Engineer",
            summary="Experienced engineer with passion for building scalable applications"
        )
        
        db.add(candidate)
        db.commit()
        db.refresh(candidate)
        print("SUCCESS: Candidate model test successful")
        
        # Test creating a job record
        job = Job(
            source="mock",
            source_job_id="test-123",
            title="Senior Software Engineer",
            company="Test Company",
            location="San Francisco, CA"
        )
        
        db.add(job)
        db.commit()
        db.refresh(job)
        print("SUCCESS: Job model test successful")
        
        # Test creating an application record
        application = Application(
            job_id=1,
            candidate_id=1,
            status="discovered"
        )
        
        db.add(application)
        db.commit()
        db.refresh(application)
        print("SUCCESS: Application model test successful")
        
        db.close()
        
        print("\nSUCCESS: All database tests passed!")
        return True
        
    except Exception as e:
        print(f"ERROR: Database test failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_db_setup()
    sys.exit(0 if success else 1)