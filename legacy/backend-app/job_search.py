"""
Job Search Service for Job Hunter
"""
from typing import List, Dict, Any
import logging
from ..sources import get_job_source

logger = logging.getLogger(__name__)

class JobSearchService:
    """Service to search and fetch jobs from various sources"""
    
    async def search_jobs(self, query: str, limit: int = 10, source_names: List[str] = None) -> List[Dict[str, Any]]:
        """Search for jobs matching the given query across specified sources"""
        if source_names is None:
            # Use all available sources
            from ..sources import job_source_registry
            source_names = list(job_source_registry.keys())
        
        jobs_found = []
        
        for source_name in source_names:
            try:
                logger.info(f"Searching {source_name} for query: {query}")
                source = get_job_source(source_name)
                
                if await source.health_check():
                    # If the source is healthy, search jobs
                    jobs = await source.search_jobs(query, limit)
                    for job in jobs:
                        # Normalize the job to ensure consistent structure
                        normalized_job = await source.normalize_job(job.model_dump())
                        # Add source metadata
                        normalized_job.source_name = source_name
                        jobs_found.append(normalized_job)
                else:
                    logger.warning(f"Source {source_name} is not healthy, skipping")
                    
            except Exception as e:
                logger.error(f"Error searching job source {source_name}: {str(e)}")
                continue
                
        return jobs_found
    
    async def fetch_job_details(self, job_id: str, source_name: str) -> Dict[str, Any]:
        """Fetch detailed information about a specific job"""
        try:
            logger.info(f"Fetching job details for {job_id} from {source_name}")
            
            source = get_job_source(source_name)
            if await source.health_check():
                # In a real implementation this might fetch more details
                return {"id": job_id, "status": "fetched", "source": source_name}
                
        except Exception as e:
            logger.error(f"Error fetching job {job_id}: {str(e)}")
            raise
            
        return {"id": job_id, "status": "failed", "error": str(e)}

# Create a singleton instance
job_search_service = JobSearchService()