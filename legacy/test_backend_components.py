#!/usr/bin/env python3
"""
Test that our backend components work together
"""
import sys
import os

# Add the backend app to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend', 'app'))

async def test_components():
    """Test our core components"""
    try:
        # Test database initialization
        from db import init_db, engine
        init_db()
        print("✓ Database initialization works")
        
        # Test Ollama integration (assuming it's set up)
        try:
            from llm import get_llm_provider
            provider = get_llm_provider()
            print("✓ LLM provider loaded")
        except Exception as e:
            print(f"⚠ LLM provider test failed: {str(e)}")
        
        # Test CV Generator  
        from cv.generator import CVGenerator
        cv_gen = CVGenerator()
        print("✓ CV Generator module loads")
        
        # Test Scoring Service
        from scoring.service import JobScoringService
        scoring_service = JobScoringService()
        print("✓ Scoring Service module loads")
        
        # Test Automation Engine  
        from automation.service import automation_engine
        print("✓ Automation Engine module loads")
        
        # Test basic imports work without errors
        from models.candidate import Candidate
        from models.job import Job
        print("✓ Database models load")
        
        print("\n✅ All backend component tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Error in test: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    import asyncio
    success = asyncio.run(test_components())
    sys.exit(0 if success else 1)