"""
Job Scoring and Matching Service for Job Hunter
"""
from typing import List, Dict, Any, Optional
import logging
from ..llm import get_llm_provider
from ..models.job import Job
from ..models.candidate import Candidate

logger = logging.getLogger(__name__)

class JobScoringService:
    """Service to score and match jobs with candidates using LLMs"""
    
    def __init__(self):
        self.llm_provider = get_llm_provider()
    
    async def score_job(self, candidate: Candidate, job: Job) -> float:
        """Score how well a job matches a candidate's profile"""
        try:
            prompt = f"""
            Score how well this job matches the candidate's profile.
            
            Candidate Profile:
            Name: {candidate.name}
            Headline: {candidate.headline}
            Summary: {candidate.summary or 'N/A'}
            Skills: {', '.join(candidate.skills) if candidate.skills else 'N/A'}
            Technologies: {', '.join(candidate.technologies) if candidate.technologies else 'N/A'}
            Experience: {candidate.years_of_experience} years
            Location: {candidate.location or 'N/A'}
            
            Job Description:
            Title: {job.title}
            Company: {job.company}
            Location: {job.location}
            Summary: {job.summary or 'N/A'}
            Requirements: {job.requirements or 'N/A'}
            Technologies: {job.technologies or 'N/A'}
            
            Please rate with a score from 0 to 100 based on:
            - Relevant skills match
            - Experience level match
            - Location compatibility
            - Company fit
            - Overall role suitability
            
            Respond only with the numeric score (0-100).
            """
            
            # Get just the LLM score as text
            response = await self.llm_provider.generate_text(prompt)
            score = float(response.strip())
            
            return max(0, min(100, score))  # Ensure score is between 0 and 100
            
        except Exception as e:
            logger.error(f"Error scoring job {job.id}: {str(e)}")
            # Return a default score if there's an error
            return 0.0
    
    async def match_jobs_to_candidate(self, candidate: Candidate, jobs: List[Job]) -> List[Dict[str, Any]]:
        """Match multiple jobs to a candidate and return scores"""
        matched_jobs = []
        
        for job in jobs:
            score = await self.score_job(candidate, job)
            matched_jobs.append({
                'job': job,
                'score': score
            })
        
        # Sort by score descending (highest first)
        matched_jobs.sort(key=lambda x: x['score'], reverse=True)
        return matched_jobs