"""
zkLogin API endpoints for OAuth authentication.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.db.session import get_supabase_client
from app.services.salt_service import SaltService
from supabase import Client
import logging
import jwt
from typing import Optional

router = APIRouter()
logger = logging.getLogger(__name__)


class SaltRequest(BaseModel):
    """Request model for salt generation."""
    jwt_token: str
    oauth_provider: str


class SaltResponse(BaseModel):
    """Response model for salt."""
    user_salt: str
    zklogin_address: Optional[str] = None


class VerifyRequest(BaseModel):
    """Request model for zkLogin verification."""
    zklogin_address: str
    jwt_token: str
    proof: dict


@router.post("/salt", response_model=SaltResponse, summary="Get or create user salt for zkLogin")
async def get_salt(
    request: SaltRequest,
    db: Client = Depends(get_supabase_client)
):
    """
    Get or create a user salt for zkLogin address derivation.
    
    The salt is deterministic based on the user's OAuth identity (iss, aud, sub)
    and is used to derive a unique Sui address.
    """
    try:
        # Decode JWT without verification (verification happens on-chain)
        decoded = jwt.decode(
            request.jwt_token,
            options={"verify_signature": False}
        )
        
        # Extract required claims
        iss = decoded.get("iss")
        aud = decoded.get("aud")
        sub = decoded.get("sub")
        
        if not all([iss, aud, sub]):
            raise HTTPException(
                status_code=400,
                detail="JWT missing required claims (iss, aud, sub)"
            )
        
        # Get or create salt
        user_salt = await SaltService.get_or_create_salt(
            db=db,
            iss=iss,
            aud=aud,
            sub=sub
        )
        
        logger.info(f"Salt retrieved for user: {sub[:8]}... from provider: {request.oauth_provider}")
        
        return SaltResponse(
            user_salt=user_salt
        )
        
    except jwt.DecodeError as e:
        logger.error(f"JWT decode error: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"Invalid JWT: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Error getting salt: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error"
        )


@router.post("/verify", summary="Verify zkLogin signature (optional)")
async def verify_zklogin(
    request: VerifyRequest,
    db: Client = Depends(get_supabase_client)
):
    """
    Optional endpoint to verify zkLogin signature server-side.
    
    Note: The primary verification happens on-chain by Sui validators.
    This endpoint can be used for additional application-level checks.
    """
    try:
        # Decode JWT
        decoded = jwt.decode(
            request.jwt_token,
            options={"verify_signature": False}
        )
        
        # Basic validation
        iss = decoded.get("iss")
        aud = decoded.get("aud")
        sub = decoded.get("sub")
        
        if not all([iss, aud, sub]):
            return {"verified": False, "reason": "Missing required JWT claims"}
        
        # Check if address matches expected format
        if not request.zklogin_address.startswith("0x"):
            return {"verified": False, "reason": "Invalid address format"}
        
        logger.info(f"zkLogin verification requested for address: {request.zklogin_address[:10]}...")
        
        return {
            "verified": True,
            "message": "Basic validation passed. Full verification happens on-chain."
        }
        
    except Exception as e:
        logger.error(f"Error verifying zkLogin: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error"
        )
