"""
Salt service for zkLogin authentication.
Generates and manages user salts for zkLogin address derivation.
"""
import hashlib
import secrets
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class SaltService:
    """Service for managing zkLogin user salts."""
    
    @staticmethod
    def generate_salt() -> str:
        """
        Generate a cryptographically secure random salt.
        
        Returns:
            str: A 32-byte hex-encoded salt
        """
        return secrets.token_hex(32)
    
    @staticmethod
    def derive_salt_key(iss: str, aud: str, sub: str) -> str:
        """
        Derive a unique key for salt storage based on OAuth claims.
        
        Args:
            iss: OAuth issuer (e.g., 'https://accounts.google.com')
            aud: OAuth audience (client ID)
            sub: OAuth subject identifier (user ID from provider)
            
        Returns:
            str: SHA-256 hash of the combined claims
        """
        combined = f"{iss}|{aud}|{sub}"
        return hashlib.sha256(combined.encode()).hexdigest()
    
    @staticmethod
    async def get_or_create_salt(
        db,
        iss: str,
        aud: str,
        sub: str
    ) -> str:
        """
        Get existing salt or create a new one for a user.
        
        Args:
            db: Supabase client
            iss: OAuth issuer
            aud: OAuth audience
            sub: OAuth subject identifier
            
        Returns:
            str: The user's salt
        """
        salt_key = SaltService.derive_salt_key(iss, aud, sub)
        
        try:
            # Try to fetch existing salt
            result = db.table("zklogin_salts").select("salt").eq("salt_key", salt_key).execute()
            
            if result.data and len(result.data) > 0:
                logger.info(f"Retrieved existing salt for key: {salt_key[:8]}...")
                return result.data[0]["salt"]
            
            # Generate new salt
            new_salt = SaltService.generate_salt()
            
            # Store in database
            db.table("zklogin_salts").insert({
                "salt_key": salt_key,
                "salt": new_salt,
                "iss": iss,
                "aud": aud,
                "sub": sub
            }).execute()
            
            logger.info(f"Created new salt for key: {salt_key[:8]}...")
            return new_salt
            
        except Exception as e:
            logger.error(f"Error managing salt: {str(e)}")
            raise
