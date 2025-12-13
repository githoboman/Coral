# app/api/routers/analytics.py
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
import logging

from app.services.analytics_service import analytics_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/analytics/wallet/{address}/overview")
async def get_wallet_overview(address: str):
    """
    Get comprehensive wallet overview with balances and prices
    
    Args:
        address: Sui wallet address (0x...)
        
    Returns:
        Wallet balances with current prices and total portfolio value
    """
    if not address.startswith("0x"):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")
    
    result = await analytics_service.get_wallet_overview(address)
    
    if not result.get("success"):
        raise HTTPException(
            status_code=500, 
            detail=result.get("error", "Failed to fetch wallet overview")
        )
    
    return result["data"]


@router.get("/analytics/wallet/{address}/transactions")
async def get_transaction_history(
    address: str,
    limit: int = Query(50, ge=1, le=100),
    cursor: Optional[str] = None
):
    """
    Get transaction history for a wallet
    
    Args:
        address: Sui wallet address
        limit: Number of transactions to fetch (1-100)
        cursor: Pagination cursor for next page
        
    Returns:
        List of transactions with pagination info
    """
    if not address.startswith("0x"):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")
    
    result = await analytics_service.get_transaction_history(address, limit, cursor)
    
    if not result.get("success"):
        raise HTTPException(
            status_code=500,
            detail=result.get("error", "Failed to fetch transactions")
        )
    
    return result["data"]


@router.get("/analytics/wallet/{address}/stats")
async def get_wallet_stats(address: str):
    """
    Get basic trading statistics for a wallet
    
    Args:
        address: Sui wallet address
        
    Returns:
        Basic stats including transaction count and placeholder PnL data
    """
    if not address.startswith("0x"):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")
    
    result = await analytics_service.calculate_basic_stats(address)
    
    if not result.get("success"):
        raise HTTPException(
            status_code=500,
            detail=result.get("error", "Failed to calculate stats")
        )
    
    return result["data"]


@router.get("/analytics/wallet/{address}/nfts")
async def get_wallet_nfts(
    address: str,
    limit: int = Query(50, ge=1, le=100)
):
    """
    Get NFTs owned by a wallet
    
    Args:
        address: Sui wallet address
        limit: Maximum number of NFTs to fetch (1-100)
        
    Returns:
        List of NFTs with metadata and display info
    """
    if not address.startswith("0x"):
        raise HTTPException(status_code=400, detail="Invalid wallet address format")
    
    result = await analytics_service.get_wallet_nfts(address, limit)
    
    if not result.get("success"):
        raise HTTPException(
            status_code=500,
            detail=result.get("error", "Failed to fetch NFTs")
        )
    
    return result["data"]
